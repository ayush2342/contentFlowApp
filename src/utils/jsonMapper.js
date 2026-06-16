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

const resolveMediaSrc = (fileName) => {
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
        src: resolveMediaSrc(mediaItem.fileName),
        alt: mediaItem.caption || mediaItem.fileName,
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
