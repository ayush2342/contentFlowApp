const COMPONENT_TYPE_MAP = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  image: 'ImageBlock',
};

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '');

const formatBookTitle = (bookId) =>
  bookId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const mediaAssets = import.meta.glob('../media/*', {
  eager: true,
  query: '?url',
  import: 'default',
});

const normalizePublicAssetPath = (value) =>
  String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .trim();

const resolveMediaSrc = (fileName, sourcePath) => {
  const normalizedSourcePath = normalizePublicAssetPath(sourcePath);

  if (normalizedSourcePath) {
    return `/${normalizedSourcePath}`;
  }

  const assetKey = `../media/${fileName}`;
  return mediaAssets[assetKey] ?? `/media/${fileName}`;
};

const mapContentItem = (item, media, index) => {
  const registryType = COMPONENT_TYPE_MAP[item.type];

  if (!registryType) {
    return {
      id: `content-${index}`,
      type: '__unsupported__',
      props: { originalType: item.type, payload: item },
    };
  }

  if (item.type === 'heading') {
    return {
      id: `content-${index}`,
      type: 'Heading',
      props: { text: item.text, level: 2 },
    };
  }

  if (item.type === 'paragraph') {
    return {
      id: `content-${index}`,
      type: 'Paragraph',
      props: { text: item.text },
    };
  }

  if (item.type === 'image') {
    const mediaItem = media?.[item.mediaId];

    if (!mediaItem) {
      return {
        id: `content-${index}`,
        type: 'Callout',
        props: {
          variant: 'warning',
          title: 'Missing media',
          text: `Media reference "${item.mediaId}" was not found in the media catalog.`,
        },
      };
    }

    return {
      id: `content-${index}`,
      type: 'ImageBlock',
      props: {
        src: resolveMediaSrc(mediaItem.fileName, mediaItem.sourcePath),
        alt: mediaItem.caption || mediaItem.fileName || 'Course image',
        caption: mediaItem.caption,
      },
    };
  }

  return null;
};

const mapSectionToLesson = (section, media) => {
  const sectionId = `section-${slugify(section.sectionNumber)}`;
  const mappedContent =
    section.content
      ?.map((item, index) => mapContentItem(item, media, index))
      .filter(Boolean) ?? [];

  const components = [
    {
      id: `${sectionId}-title`,
      type: 'Heading',
      props: {
        text: `${section.sectionNumber} ${section.title}`,
        level: 1,
      },
    },
  ];

  if (section.learningObjectives?.length) {
    components.push({
      id: `${sectionId}-objectives`,
      type: 'LearningObjective',
      props: {
        title: 'Learning Objectives',
        objectives: section.learningObjectives,
      },
    });
  }

  components.push(...mappedContent);

  return {
    id: sectionId,
    sectionNumber: section.sectionNumber,
    title: section.title,
    description: `Section ${section.sectionNumber}`,
    learningObjectives: section.learningObjectives,
    pages: [
      {
        id: `page-${slugify(section.sectionNumber)}`,
        title: section.title,
        sectionNumber: section.sectionNumber,
        components,
      },
    ],
  };
};

const mapChapter = (chapter, media) => ({
  id: `chapter-${chapter.chapterNumber}`,
  chapterNumber: chapter.chapterNumber,
  title: chapter.title,
  description: chapter.introduction,
  outline: chapter.outline,
  lessons: chapter.sections?.map((section) => mapSectionToLesson(section, media)) ?? [],
});

/**
 * Transforms Transformation Team output.json into the internal course model
 * consumed by pages, Redux, and LessonRenderer without mutating the source JSON.
 */
export const mapOutputJson = (output) => {
  const media = output.media ?? {};

  return {
    bookId: output.bookId,
    media,
    books: [
      {
        id: output.bookId,
        title: formatBookTitle(output.bookId),
        description: output.chapters?.[0]?.introduction ?? '',
        chapters: output.chapters?.map((chapter) => mapChapter(chapter, media)) ?? [],
      },
    ],
  };
};

export const getUnsupportedContentTypes = (output) => {
  const types = new Set();

  output.chapters?.forEach((chapter) => {
    chapter.sections?.forEach((section) => {
      section.content?.forEach((item) => {
        if (!COMPONENT_TYPE_MAP[item.type]) {
          types.add(item.type);
        }
      });
    });
  });

  return [...types];
};

const safeParseTag = (tag) => {
  if (!tag || typeof tag !== 'string') return null;
  try {
    return JSON.parse(tag);
  } catch {
    return null;
  }
};

const flattenTexts = (node) => {
  if (!node) return [];
  if (node.kind === 'text' && typeof node.text === 'string') {
    return [node.text];
  }
  if (!Array.isArray(node.children)) return [];
  return node.children.flatMap((child) => flattenTexts(child));
};

const collectParagraphs = (node) => {
  if (!node) return [];
  if (node.kind === 'paragraph') {
    const text = flattenTexts(node).join('').trim();
    const isList = Boolean(node.props?.list);
    return [{ text, isList }];
  }
  if (!Array.isArray(node.children)) return [];
  return node.children.flatMap((child) => collectParagraphs(child));
};

const collectFirstImage = (node) => {
  if (!node) return null;
  if (node.kind === 'image' && typeof node.path === 'string') {
    return node.path;
  }
  if (!Array.isArray(node.children)) return null;
  for (const child of node.children) {
    const imagePath = collectFirstImage(child);
    if (imagePath) return imagePath;
  }
  return null;
};

const basenameFromPath = (value) => {
  const normalized = String(value ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
};

const stripFigurePrefix = (captionText) =>
  captionText
    .replace(/^FIGURE\s+\d+(\.\d+)?\s*/i, '')
    .replace(/^\s*[-–:]\s*/, '')
    .trim();

const normalizeText = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const extractLearningObjectives = (text) => {
  const normalized = normalizeText(text).replace(
    /^By the end of this section, you will be able to:\s*/i,
    ''
  );

  if (!normalized) return [];

  const objectiveStartRegex =
    /\b(Identify|Describe|List|Explain|Define|Compare|Analyze|Discuss|Evaluate|Recognize|Differentiate|Summarize)\b/g;

  const starts = [...normalized.matchAll(objectiveStartRegex)].map((match) => match.index);
  if (starts.length <= 1) return [normalized];

  const objectives = [];
  starts.forEach((start, index) => {
    const end = starts[index + 1] ?? normalized.length;
    const objective = normalized.slice(start, end).trim();
    if (objective) objectives.push(objective);
  });

  return objectives;
};

const parseSectionHeading = (text) => {
  const normalized = normalizeText(text);
  const match = normalized.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
  if (!match) return null;
  return { sectionNumber: match[1], sectionTitle: match[2] };
};

const titleFromBookId = (bookId) => {
  if (!bookId) return 'Biology 101';
  return bookId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const mapClassTemplateJson = (nodes) => {
  const outline = [];
  const content = [];
  const learningObjectives = [];
  const media = {};

  let chapterNumber = 1;
  let chapterTitle = 'Introduction to Biology';
  let sectionNumber = '1.1';
  let sectionTitle = 'Themes and Concepts of Biology';
  let chapterIntro = '';
  let mediaIndex = 1;
  let captureLearningObjectives = false;

  nodes.forEach((node) => {
    const type = node?.type;
    const dataText = normalizeText(node?.data?.text);

    if (type === 'LessonNumber' && dataText) {
      const match = dataText.match(/chapter\s+(\d+)/i);
      if (match) chapterNumber = Number(match[1]);
      return;
    }

    if (type === 'SectionTitle' && dataText) {
      const sectionMeta = parseSectionHeading(dataText);
      if (sectionMeta) {
        sectionNumber = sectionMeta.sectionNumber;
        sectionTitle = sectionMeta.sectionTitle;
      } else {
        sectionTitle = dataText;
      }
      return;
    }

    if (type === 'Topic' && dataText) {
      const sectionMeta = parseSectionHeading(dataText);
      if (sectionMeta) {
        outline.push(sectionMeta.sectionTitle);
      } else {
        content.push({ type: 'heading', text: dataText });
      }
      return;
    }

    if (type === 'ChapterOverview' && dataText) {
      if (/chapter outline/i.test(dataText)) return;

      if (/learning objectives/i.test(dataText)) {
        captureLearningObjectives = true;
        return;
      }

      content.push({ type: 'heading', text: dataText });
      return;
    }

    if (type === 'Image' && node?.data?.url) {
      const mediaId = `tree-media-${mediaIndex++}`;
      const caption = normalizeText(node?.data?.caption);
      const urlPath = normalizePublicAssetPath(node.data.url);

      media[mediaId] = {
        fileName: basenameFromPath(urlPath),
        sourcePath: urlPath,
        caption: stripFigurePrefix(caption) || `Image ${mediaIndex - 1}`,
      };

      content.push({ type: 'image', mediaId });
      return;
    }

    if (type === 'Text' && dataText) {
      if (!chapterIntro) {
        chapterIntro = dataText.replace(/^Introduction\s+/i, '').trim();
      }

      if (captureLearningObjectives) {
        const objectives = extractLearningObjectives(dataText);
        if (objectives.length) {
          learningObjectives.push(...objectives);
          captureLearningObjectives = false;
          return;
        }
      }

      content.push({ type: 'paragraph', text: dataText });
    }
  });

  const outputLike = {
    bookId: 'biology-101',
    media,
    chapters: [
      {
        chapterNumber,
        title: chapterTitle,
        outline,
        introduction: chapterIntro,
        sections: [
          {
            sectionNumber,
            title: sectionTitle,
            learningObjectives,
            content,
          },
        ],
      },
    ],
  };

  return {
    bookId: outputLike.bookId,
    media: outputLike.media,
    books: [
      {
        id: outputLike.bookId,
        title: titleFromBookId(outputLike.bookId),
        description: outputLike.chapters[0]?.introduction ?? '',
        chapters: outputLike.chapters.map((chapter) => mapChapter(chapter, outputLike.media)),
      },
    ],
  };
};

export const mapTreeOutputJson = (treeNodes) => {
  const nodes = Array.isArray(treeNodes) ? treeNodes : [];
  const firstNode = nodes[0];

  if (firstNode?.type && firstNode?.data) {
    return mapClassTemplateJson(nodes);
  }

  const outline = [];
  const content = [];
  const learningObjectives = [];
  const media = {};

  let chapterNumber = 1;
  let chapterTitle = 'Introduction to Biology';
  let sectionNumber = '1.1';
  let sectionTitle = 'Themes and Concepts of Biology';
  let chapterIntro = '';
  let nextImagePath = null;
  let captureLearningObjectives = false;
  let mediaIndex = 1;
  let sawSectionTitle = false;

  for (const node of nodes) {
    const tagMeta = safeParseTag(node.tag);
    const tagType = tagMeta?.type ?? null;
    const paragraphs = collectParagraphs(node);
    const paragraphTexts = paragraphs
      .map((item) => item.text)
      .filter(Boolean);
    const joinedText = paragraphTexts.join(' ').trim();

    if (tagType === 'lesson-number' && joinedText) {
      const match = joinedText.match(/chapter\s+(\d+)/i);
      if (match) chapterNumber = Number(match[1]);
      continue;
    }

    if (!tagType && paragraphTexts.length) {
      const likelyTitle = paragraphTexts.find((text) => text.split(/\s+/).length <= 6);
      if (likelyTitle && !sawSectionTitle) {
        chapterTitle = likelyTitle;
      }
      continue;
    }

    if (tagType === 'topic' && joinedText && /^\d+(\.\d+)?\s+/.test(joinedText)) {
      outline.push(joinedText.replace(/^\d+(\.\d+)?\s+/, '').trim());
      continue;
    }

    if (tagType === 'section-title' && joinedText) {
      const match = joinedText.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
      if (match) {
        sectionNumber = match[1];
        sectionTitle = match[2];
      } else {
        sectionTitle = joinedText;
      }
      sawSectionTitle = true;
      continue;
    }

    if (tagType === 'chapter-overview' && /learning objectives/i.test(joinedText)) {
      captureLearningObjectives = true;
      continue;
    }

    if (tagType === 'text' && captureLearningObjectives) {
      const listItems = paragraphs
        .filter((p) => p.isList && p.text)
        .map((p) => p.text.trim());
      if (listItems.length) {
        learningObjectives.push(...listItems);
      }
      captureLearningObjectives = false;
      continue;
    }

    if (tagType === 'figure-image') {
      nextImagePath = collectFirstImage(node);
      continue;
    }

    if (tagType === 'figure-caption' && nextImagePath) {
      const caption = stripFigurePrefix(joinedText);
      const mediaId = `tree-media-${mediaIndex++}`;
      media[mediaId] = {
        fileName: basenameFromPath(nextImagePath),
        sourcePath: normalizePublicAssetPath(nextImagePath),
        caption: caption || `Image ${mediaIndex - 1}`,
      };
      content.push({ type: 'image', mediaId });
      nextImagePath = null;
      continue;
    }

    if (tagType === 'chapter-overview' && joinedText && !/chapter outline/i.test(joinedText)) {
      content.push({ type: 'heading', text: joinedText });
      continue;
    }

    if (tagType === 'text' && paragraphTexts.length) {
      paragraphTexts.forEach((text) => {
        if (text) content.push({ type: 'paragraph', text });
      });
    }
  }

  if (!chapterIntro) {
    const firstParagraph = content.find((item) => item.type === 'paragraph');
    chapterIntro = firstParagraph?.text ?? '';
  }

  const outputLike = {
    bookId: `biology-${String(chapterNumber).padStart(3, '0')}`,
    media,
    chapters: [
      {
        chapterNumber,
        title: chapterTitle,
        outline,
        introduction: chapterIntro,
        sections: [
          {
            sectionNumber,
            title: sectionTitle,
            learningObjectives,
            content,
          },
        ],
      },
    ],
  };

  return {
    bookId: outputLike.bookId,
    media: outputLike.media,
    books: [
      {
        id: outputLike.bookId,
        title: titleFromBookId(outputLike.bookId),
        description: outputLike.chapters[0]?.introduction ?? '',
        chapters: outputLike.chapters.map((chapter) => mapChapter(chapter, outputLike.media)),
      },
    ],
  };
};
