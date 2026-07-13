const COMPONENT_TYPE_MAP = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  image: 'ImageBlock',
  learningObjective: 'LearningObjective',
  iconLabel: 'IconLabel',
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

const resolveMediaSrc = (fileName, sourcePath, mediaBaseUrl, tenantId) => {
  const normalizedSourcePath = normalizePublicAssetPath(sourcePath);

  if (normalizedSourcePath && mediaBaseUrl) {
    const query = new URLSearchParams();
    query.set('key', normalizedSourcePath);
    if (tenantId) query.set('tenantId', tenantId);
    return `${mediaBaseUrl}?${query.toString()}`;
  }

  if (normalizedSourcePath) {
    return `/${normalizedSourcePath}`;
  }

  const assetKey = `../media/${fileName}`;
  return mediaAssets[assetKey] ?? `/media/${fileName}`;
};

const mapContentItem = (item, media, index, options = {}) => {
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
      props: { text: item.text, level: item.level || 2, variant: item.variant || '' },
    };
  }

  if (item.type === 'paragraph') {
    return {
      id: `content-${index}`,
      type: 'Paragraph',
      props: { text: item.text },
    };
  }

  if (item.type === 'learningObjective') {
    return {
      id: `content-${index}`,
      type: 'LearningObjective',
      props: {
        title: item.title || 'LEARNING OBJECTIVES',
        introText: item.introText || '',
        objectives: item.objectives || [],
      },
    };
  }

  if (item.type === 'iconLabel') {
    const mediaItem = media?.[item.mediaId];
    return {
      id: `content-${index}`,
      type: 'IconLabel',
      props: {
        text: item.text,
        src: mediaItem
          ? resolveMediaSrc(
              mediaItem.fileName,
              mediaItem.sourcePath,
              options.mediaBaseUrl,
              options.tenantId
            )
          : '',
      },
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
        src: resolveMediaSrc(
          mediaItem.fileName,
          mediaItem.sourcePath,
          options.mediaBaseUrl,
          options.tenantId
        ),
        alt: mediaItem.caption || mediaItem.fileName || 'Course image',
        caption: mediaItem.caption,
      },
    };
  }

  return null;
};

const mapSectionToLesson = (section, media, options = {}, sectionIndex = 0) => {
  const sectionKey = section.sectionNumber || section.title || `section-${sectionIndex + 1}`;
  const sectionId = `section-${slugify(sectionKey) || sectionIndex + 1}`;
  const mappedContent =
    section.content
      ?.map((item, index) => mapContentItem(item, media, index, options))
      .filter(Boolean) ?? [];

  const components = [...mappedContent];

  return {
    id: sectionId,
    sectionNumber: section.sectionNumber,
    title: section.title,
    description: section.sectionNumber ? `Section ${section.sectionNumber}` : '',
    learningObjectives: section.learningObjectives,
    pages: [
      {
        id: `page-${slugify(sectionKey) || sectionIndex + 1}`,
        title: section.title || section.sectionNumber || `Section ${sectionIndex + 1}`,
        sectionNumber: section.sectionNumber,
        components,
      },
    ],
  };
};

const mapChapter = (chapter, media, options = {}, chapterIndex = 0) => {
  const chapterKey = chapter.chapterNumber || chapter.title || `chapter-${chapterIndex + 1}`;
  return {
  id: `chapter-${slugify(chapterKey) || chapterIndex + 1}`,
  chapterNumber: chapter.chapterNumber,
  title: chapter.title,
  description: chapter.description || '',
  outline: chapter.outline,
  lessons:
    chapter.sections?.map((section, sectionIndex) =>
      mapSectionToLesson(section, media, options, sectionIndex)
    ) ?? [],
  };
};

/**
 * Transforms Transformation Team output.json into the internal course model
 * consumed by pages, Redux, and LessonRenderer without mutating the source JSON.
 */
export const mapOutputJson = (output, options = {}) => {
  const media = output.media ?? {};

  return {
    bookId: output.bookId,
    media,
    books: [
      {
        id: output.bookId,
        title: formatBookTitle(output.bookId),
        description: output.description ?? '',
        chapters: output.chapters?.map((chapter) => mapChapter(chapter, media, options)) ?? [],
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

const normalizeText = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const NORMALIZED_CLASS_TYPE_MAP = {
  chapternumber: 'ChapterNumber',
  chaptertitle: 'ChapterTitle',
  chapterheading: 'ChapterHeading',
  chapteroverview: 'ChapterOverview',
  lessonnumber: 'LessonNumber',
  lessontitle: 'LessonTitle',
  lessonoverview: 'LessonOverview',
  learningobjectives: 'LearningObjectives',
  sectiontitle: 'SectionTitle',
  subsectiontitle: 'SubSectionTitle',
  greensubsectiontitle: 'GreenSubSectionTitle',
  subtitleslist: 'SubTitlesList',
  subtitle: 'SubTitle',
  partnumber: 'PartNumber',
  paragraphtext: 'ParagraphText',
  paragraph: 'ParagraphText',
  paragrapghtext: 'ParagraphText',
  bulletlist: 'BulletList',
  bullestlist: 'BulletList',
  text: 'Text',
  image: 'Image',
  figureimage: 'Image',
  figurecaption: 'FigureCaption',
  caption: 'FigureCaption',
  logowithtext: 'LogoWithText',
};

const normalizeClassTemplateRawType = (rawType) => {
  const value = normalizeText(rawType);
  if (!value) return value;
  const normalizedKey = value.toLowerCase().replace(/[\s_-]+/g, '');
  return NORMALIZED_CLASS_TYPE_MAP[normalizedKey] || value;
};

const toCanonicalClassType = (rawType) => rawType;

const extractLearningObjectives = (text) => {
  const normalized = normalizeText(text);

  if (!normalized) return [];

  const objectiveStartRegex =
    /\b(Identify|Describe|List|Explain|Define|Compare|Analyze|Discuss|Evaluate|Recognize|Differentiate|Summarize)\b/g;

  const starts = [...normalized.matchAll(objectiveStartRegex)].map((match) => match.index);
  if (starts.length === 0) return [];
  if (starts.length === 1) return [normalized];

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

const findFirstTypeText = (pages, wantedType) => {
  const normalizedWanted = normalizeClassTemplateRawType(wantedType);
  for (const page of pages) {
    const blocks = Array.isArray(page?.content) ? page.content : [];
    for (const block of blocks) {
      const normalizedType = normalizeClassTemplateRawType(block?.type);
      if (normalizedType === normalizedWanted) {
        const text = normalizeText(block?.data?.text);
        if (text) return text;
      }
    }
  }
  return '';
};

const mapPagedBlockToComponent = (block, index, ctx) => {
  const rawType = normalizeClassTemplateRawType(block?.type);
  const type = toCanonicalClassType(rawType);
  const text = normalizeText(block?.data?.text);

  const headingVariantMap = {
    ChapterNumber: 'chapterNumber',
    PartNumber: 'partNumber',
    ChapterHeading: 'chapterHeading',
    ChapterTitle: 'chapterTitle',
    ChapterOverview: 'chapterOverview',
    LessonTitle: 'lessonTitle',
    LessonOverview: 'lessonOverview',
    SectionTitle: 'sectionTitle',
    SubSectionTitle: 'subSectionTitle',
    GreenSubSectionTitle: 'greenSubSectionTitle',
    SubTitle: 'subTitle',
    SubTitlesList: 'subTitlesList',
  };

  const headingVariant = headingVariantMap[type];
  if (headingVariant && text) {
    return {
      id: `content-${index}`,
      type: 'Heading',
      props: { text, level: 2, variant: headingVariant },
    };
  }

  if ((type === 'ParagraphText' || type === 'Text') && text) {
    return {
      id: `content-${index}`,
      type: 'Paragraph',
      props: { text },
    };
  }

  if (type === 'LearningObjectives' && text) {
    return {
      id: `content-${index}`,
      type: 'LearningObjective',
      props: {
        title: text,
        introText: '',
        objectives: [],
      },
    };
  }

  if (type === 'BulletList') {
    const items = Array.isArray(block?.data?.items)
      ? block.data.items.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    if (!items.length) return null;

    const lastComponent = ctx.components[ctx.components.length - 1];
    if (lastComponent?.type === 'LearningObjective') {
      lastComponent.props.objectives = [...(lastComponent.props.objectives || []), ...items];
      return null;
    }

    return {
      id: `content-${index}`,
      type: 'Paragraph',
      props: { text: items.join(' ') },
    };
  }

  if (type === 'Image' && block?.data?.url) {
    const urlPath = normalizePublicAssetPath(block.data.url);
    const caption = normalizeText(block?.data?.caption);
    const mediaId = `tree-media-${ctx.mediaIndex++}`;
    ctx.media[mediaId] = {
      fileName: basenameFromPath(urlPath),
      sourcePath: urlPath,
      caption,
    };
    ctx.pendingImageMediaId = mediaId;
    return {
      id: `content-${index}`,
      type: 'ImageBlock',
      props: {
        src: resolveMediaSrc(
          ctx.media[mediaId].fileName,
          ctx.media[mediaId].sourcePath,
          ctx.options.mediaBaseUrl,
          ctx.options.tenantId
        ),
        alt: caption || ctx.media[mediaId].fileName || 'Course image',
        caption,
      },
    };
  }

  if (type === 'FigureCaption' && text) {
    if (ctx.pendingImageMediaId && ctx.media[ctx.pendingImageMediaId]) {
      ctx.media[ctx.pendingImageMediaId].caption = text;
      const lastComponent = ctx.components[ctx.components.length - 1];
      if (lastComponent?.type === 'ImageBlock') {
        lastComponent.props.caption = text;
        lastComponent.props.alt = text;
      }
      return null;
    }

    return {
      id: `content-${index}`,
      type: 'Paragraph',
      props: { text },
    };
  }

  if (type === 'LogoWithText') {
    const logoUrl = normalizePublicAssetPath(block?.data?.url);
    const logoText = normalizeText(block?.data?.text);
    if (!logoText) return null;

    let src = '';
    if (logoUrl) {
      const mediaId = `tree-media-${ctx.mediaIndex++}`;
      ctx.media[mediaId] = {
        fileName: basenameFromPath(logoUrl),
        sourcePath: logoUrl,
        caption: '',
      };
      src = resolveMediaSrc(
        ctx.media[mediaId].fileName,
        ctx.media[mediaId].sourcePath,
        ctx.options.mediaBaseUrl,
        ctx.options.tenantId
      );
    }

    return {
      id: `content-${index}`,
      type: 'IconLabel',
      props: { text: logoText, src },
    };
  }

  return {
    id: `content-${index}`,
    type: '__unsupported__',
    props: { originalType: block?.type, payload: block },
  };
};

const mapPagedTemplateJson = (pages, options = {}) => {
  const normalizedPages = Array.isArray(pages) ? pages : [];
  const chapterTitle = findFirstTypeText(normalizedPages, 'ChapterTitle');
  const chapterNumberText = findFirstTypeText(normalizedPages, 'ChapterNumber');
  const chapterNumberMatch = chapterNumberText.match(/(\d+)/);
  const chapterNumber = chapterNumberMatch ? Number(chapterNumberMatch[1]) : null;
  const media = {};
  let mediaIndex = 1;

  const lessons = normalizedPages.map((page, index) => {
    const blocks = Array.isArray(page?.content) ? page.content : [];
    const components = [];
    const ctx = {
      media,
      options,
      mediaIndex,
      pendingImageMediaId: null,
      components,
    };

    blocks.forEach((block, blockIndex) => {
      const component = mapPagedBlockToComponent(block, blockIndex, ctx);
      if (component) components.push(component);
    });

    mediaIndex = ctx.mediaIndex;
    const pageNo = page?.page_no ?? index + 1;
    const pageType = normalizeText(page?.page_type).toLowerCase();
    const layout = pageType === 'non-opener' ? 'two-column' : 'single-column';
    const lessonKey = `page-${pageNo}`;

    return {
      id: `section-${slugify(lessonKey) || index + 1}`,
      sectionNumber: String(pageNo),
      title: '',
      description: '',
      learningObjectives: [],
      pages: [
        {
          id: `page-${slugify(lessonKey) || index + 1}`,
          title: `Page ${pageNo}`,
          sectionNumber: String(pageNo),
          pageType: pageType || 'opener',
          layout,
          components,
        },
      ],
    };
  });

  const resolvedTitle = chapterTitle || findFirstTypeText(normalizedPages, 'LessonTitle') || 'Chapter';
  const chapterKey = chapterNumber || resolvedTitle || 'chapter-1';

  return {
    bookId: slugify(resolvedTitle) || 'course',
    media,
    books: [
      {
        id: slugify(resolvedTitle) || 'course',
        title: resolvedTitle,
        description: '',
        chapters: [
          {
            id: `chapter-${slugify(String(chapterKey)) || 1}`,
            chapterNumber,
            title: resolvedTitle,
            description: '',
            outline: [],
            lessons,
          },
        ],
      },
    ],
  };
};

const NON_TITLE_TOPIC_REGEX = [/^link to learning$/i, /^chapter outline$/i, /^learning objectives$/i];

const canUseAsChapterTitle = (text) => {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (parseSectionHeading(normalized)) return false;
  return !NON_TITLE_TOPIC_REGEX.some((pattern) => pattern.test(normalized));
};

const mapClassTemplateJson = (nodes, options = {}) => {
  const outline = [];
  const content = [];
  const media = {};

  let chapterNumber = null;
  let chapterTitle = '';
  let sectionNumber = '';
  let sectionTitle = '';
  let mediaIndex = 1;
  let captureLearningObjectives = null;
  let captureChapterOutline = false;
  let sawSectionTitle = false;
  let sectionTitleAddedToContent = false;
  let pendingImageMediaId = null;

  const flushLearningObjectives = () => {
    if (!captureLearningObjectives) return;
    const hasContent =
      Boolean(captureLearningObjectives.title) ||
      Boolean(captureLearningObjectives.introText) ||
      captureLearningObjectives.objectives.length > 0;

    if (hasContent) {
      content.push({
        type: 'learningObjective',
        title: captureLearningObjectives.title || 'LEARNING OBJECTIVES',
        introText: captureLearningObjectives.introText,
        objectives: captureLearningObjectives.objectives,
      });
    }
    captureLearningObjectives = null;
  };

  nodes.forEach((node) => {
    const rawType = normalizeClassTemplateRawType(node?.type);
    const type = toCanonicalClassType(rawType);
    const dataText = normalizeText(node?.data?.text);

    if (type !== 'FigureCaption' && type !== 'Image') {
      pendingImageMediaId = null;
    }

    if (captureChapterOutline && type !== 'LessonOverview') {
      captureChapterOutline = false;
    }

    if (type === 'LessonNumber' && dataText) {
      const match = dataText.match(/chapter\s+(\d+)/i);
      if (match) chapterNumber = Number(match[1]);
      return;
    }

    if (type === 'ChapterNumber' && dataText) {
      const match = dataText.match(/(\d+)/);
      if (match) chapterNumber = Number(match[1]);
      content.push({ type: 'heading', variant: 'chapterNumber', text: dataText, level: 2 });
      return;
    }

    if (type === 'PartNumber' && dataText) {
      flushLearningObjectives();
      content.push({ type: 'heading', variant: 'partNumber', text: dataText, level: 2 });
      return;
    }

    if (type === 'ChapterTitle' && dataText) {
      chapterTitle = dataText;
      return;
    }

    if (type === 'LessonTitle' && dataText) {
      flushLearningObjectives();
      const sectionMeta = parseSectionHeading(dataText);
      if (sectionMeta) {
        sectionNumber = sectionMeta.sectionNumber;
        sectionTitle = sectionMeta.sectionTitle;
        sawSectionTitle = true;
        content.push({ type: 'heading', variant: 'lessonTitle', text: dataText, level: 2 });
        sectionTitleAddedToContent = true;
      } else {
        content.push({ type: 'heading', variant: 'lessonTitle', text: dataText, level: 2 });
      }
      return;
    }

    if (type === 'SectionTitle' && dataText) {
      flushLearningObjectives();
      content.push({ type: 'heading', variant: 'sectionTitle', text: dataText, level: 2 });
      return;
    }

    if (type === 'LessonOverview' && dataText) {
      const sectionMeta = parseSectionHeading(dataText);
      if (sectionMeta) {
        outline.push(dataText);
        if (captureChapterOutline) {
          content.push({ type: 'paragraph', text: dataText });
        }
      }
      return;
    }

    if (type === 'ChapterOverview' && dataText) {
      flushLearningObjectives();
      if (/chapter outline/i.test(dataText)) {
        captureChapterOutline = true;
        content.push({ type: 'heading', variant: 'chapterOverview', text: dataText, level: 2 });
        return;
      }

      if (/learning objectives/i.test(dataText)) {
        captureLearningObjectives = {
          title: dataText,
          introText: '',
          objectives: [],
        };
        return;
      }

      content.push({ type: 'heading', variant: 'chapterOverview', text: dataText, level: 2 });
      return;
    }

    if (type === 'LearningObjectives' && dataText) {
      flushLearningObjectives();
      captureLearningObjectives = {
        title: dataText,
        introText: '',
        objectives: [],
      };
      return;
    }

    if (type === 'Image' && node?.data?.url) {
      flushLearningObjectives();
      const mediaId = `tree-media-${mediaIndex++}`;
      const caption = normalizeText(node?.data?.caption);
      const urlPath = normalizePublicAssetPath(node.data.url);

      media[mediaId] = {
        fileName: basenameFromPath(urlPath),
        sourcePath: urlPath,
        caption,
      };

      content.push({ type: 'image', mediaId });
      pendingImageMediaId = mediaId;
      return;
    }

    if (type === 'FigureCaption' && dataText) {
      // Word flow may emit caption as a separate block after Image.
      if (pendingImageMediaId && media[pendingImageMediaId]) {
        media[pendingImageMediaId].caption = dataText;
      } else {
        content.push({ type: 'paragraph', text: dataText });
      }
      return;
    }

    if (rawType === 'LogoWithText') {
      flushLearningObjectives();
      pendingImageMediaId = null;
      const logoUrl = normalizePublicAssetPath(node?.data?.url);
      const logoText = normalizeText(node?.data?.text);
      let logoMediaId = null;

      if (logoUrl) {
        const mediaId = `tree-media-${mediaIndex++}`;
        media[mediaId] = {
          fileName: basenameFromPath(logoUrl),
          sourcePath: logoUrl,
          caption: '',
        };
        logoMediaId = mediaId;
      }

      if (logoText) {
        content.push({ type: 'iconLabel', mediaId: logoMediaId, text: logoText });
      }
      return;
    }

    if (rawType === 'BulletList') {
      pendingImageMediaId = null;
      const items = Array.isArray(node?.data?.items)
        ? node.data.items.map((item) => normalizeText(item)).filter(Boolean)
        : [];

      if (!items.length) return;

      if (captureLearningObjectives) {
        captureLearningObjectives.objectives.push(...items);
        return;
      }

      items.forEach((item) => {
        content.push({ type: 'paragraph', text: item });
      });
      return;
    }

    if ((type === 'Text' || type === 'ParagraphText') && dataText) {
      pendingImageMediaId = null;
      if (captureLearningObjectives) {
        if (/^By the end of this section,?\s*/i.test(dataText)) {
          captureLearningObjectives.introText = dataText;
          return;
        }

        const objectives = extractLearningObjectives(dataText);
        if (objectives.length) {
          captureLearningObjectives.objectives.push(...objectives);
          return;
        }

        // End objective capture when regular body text starts.
        flushLearningObjectives();
      }

      content.push({ type: 'paragraph', text: dataText });
      return;
    }

    if (
      (type === 'SubSectionTitle' ||
        type === 'GreenSubSectionTitle' ||
        type === 'SubTitle' ||
        type === 'SubTitlesList') &&
      dataText
    ) {
      flushLearningObjectives();
      pendingImageMediaId = null;
      const variantMap = {
        SubSectionTitle: 'subSectionTitle',
        GreenSubSectionTitle: 'greenSubSectionTitle',
        SubTitle: 'subTitle',
        SubTitlesList: 'subTitlesList',
      };
      content.push({ type: 'heading', variant: variantMap[type], text: dataText, level: 2 });
      return;
    }

    if (type === 'ChapterHeading' && dataText) {
      flushLearningObjectives();
      pendingImageMediaId = null;
      content.push({ type: 'heading', variant: 'chapterHeading', text: dataText, level: 2 });
      return;
    }
  });

  flushLearningObjectives();

  if (!sectionTitleAddedToContent && sectionNumber && sectionTitle) {
    content.unshift({ type: 'heading', text: `${sectionNumber} ${sectionTitle}` });
  }

  const chapterSections =
    sawSectionTitle || content.length
      ? [
          {
            sectionNumber,
            title: sectionTitle,
            learningObjectives: [],
            content,
          },
        ]
      : [];

  const chapter =
    chapterTitle || chapterNumber != null || outline.length || chapterSections.length
      ? {
          chapterNumber,
          title: chapterTitle,
          outline,
          description: '',
          sections: chapterSections,
        }
      : null;

  const outputLike = {
    bookId: slugify(chapterTitle) || 'course',
    title: chapterTitle,
    media,
    chapters: chapter ? [chapter] : [],
  };

  return {
    bookId: outputLike.bookId,
    media: outputLike.media,
    books: [
      {
        id: outputLike.bookId,
        title: outputLike.title,
        description: '',
        chapters: outputLike.chapters.map((chapter, chapterIndex) =>
          mapChapter(chapter, outputLike.media, options, chapterIndex)
        ),
      },
    ],
  };
};

const extractPreferredNodes = (treeNodes) => {
  if (Array.isArray(treeNodes?.data?.pages)) {
    const pageNodes = treeNodes.data.pages.flatMap((page) =>
      Array.isArray(page?.content) ? page.content : []
    );
    return { nodes: pageNodes, source: 'pages' };
  }

  if (Array.isArray(treeNodes?.data?.content)) {
    return { nodes: treeNodes.data.content, source: 'content' };
  }

  if (Array.isArray(treeNodes?.data)) {
    return { nodes: treeNodes.data, source: 'array' };
  }

  // Priority 1: new final payload schema -> { pages: [{ content: [...] }] }
  if (Array.isArray(treeNodes?.pages)) {
    const pageNodes = treeNodes.pages.flatMap((page) =>
      Array.isArray(page?.content) ? page.content : []
    );
    return { nodes: pageNodes, source: 'pages' };
  }

  // Priority 2: flat content payload -> { content: [...] }
  if (Array.isArray(treeNodes?.content)) {
    return { nodes: treeNodes.content, source: 'content' };
  }

  // Priority 3: previous array payloads
  if (Array.isArray(treeNodes)) {
    return { nodes: treeNodes, source: 'array' };
  }

  return { nodes: [], source: 'none' };
};

const parseJsonSafely = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const normalizeTreePayload = (value) => {
  let current = parseJsonSafely(value);

  for (let depth = 0; depth < 6; depth += 1) {
    const parsedCurrent = parseJsonSafely(current);
    if (parsedCurrent !== current) {
      current = parsedCurrent;
      continue;
    }

    if (!current || typeof current !== 'object') break;

    if (Array.isArray(current.pages) || Array.isArray(current.content) || Array.isArray(current)) {
      break;
    }

    const next =
      current.data ??
      current.document ??
      current.output ??
      current.payload ??
      null;

    if (!next) break;
    current = next;
  }

  return current;
};

export const mapTreeOutputJson = (treeNodes, options = {}) => {
  const normalizedTreeNodes = normalizeTreePayload(treeNodes);

  if (Array.isArray(normalizedTreeNodes?.data?.pages)) {
    return mapPagedTemplateJson(normalizedTreeNodes.data.pages, options);
  }

  if (Array.isArray(normalizedTreeNodes?.pages)) {
    return mapPagedTemplateJson(normalizedTreeNodes.pages, options);
  }

  const { nodes, source } = extractPreferredNodes(normalizedTreeNodes);
  const firstNode = nodes[0];

  // New payloads and previous class-template payloads both use node.type + node.data.
  if (source === 'pages' || source === 'content' || (firstNode?.type && firstNode?.data)) {
    return mapClassTemplateJson(nodes, options);
  }

  const outline = [];
  const content = [];
  const learningObjectives = [];
  const media = {};

  let chapterNumber = null;
  let chapterTitle = '';
  let sectionNumber = '';
  let sectionTitle = '';
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

    if (tagType === 'topic' && joinedText) {
      if (/^\d+(\.\d+)?\s+/.test(joinedText)) {
        outline.push(joinedText);
      } else if (!chapterTitle && canUseAsChapterTitle(joinedText)) {
        chapterTitle = joinedText;
      } else {
        content.push({ type: 'heading', text: joinedText });
      }
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
      const caption = joinedText;
      const mediaId = `tree-media-${mediaIndex++}`;
      media[mediaId] = {
        fileName: basenameFromPath(nextImagePath),
        sourcePath: normalizePublicAssetPath(nextImagePath),
        caption: caption || '',
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

  const chapterSections =
    sawSectionTitle || learningObjectives.length
      ? [
          {
            sectionNumber,
            title: sectionTitle,
            learningObjectives,
            content,
          },
        ]
      : [];

  const chapter =
    chapterTitle || chapterNumber != null || outline.length || chapterSections.length
      ? {
          chapterNumber,
          title: chapterTitle,
          outline,
          description: '',
          sections: chapterSections,
        }
      : null;

  const outputLike = {
    bookId: slugify(chapterTitle) || 'course',
    title: chapterTitle,
    media,
    chapters: chapter ? [chapter] : [],
  };

  return {
    bookId: outputLike.bookId,
    media: outputLike.media,
    books: [
      {
        id: outputLike.bookId,
        title: outputLike.title,
        description: '',
        chapters: outputLike.chapters.map((chapter, chapterIndex) =>
          mapChapter(chapter, outputLike.media, options, chapterIndex)
        ),
      },
    ],
  };
};
