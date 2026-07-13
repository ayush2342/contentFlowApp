/**
 * Centralized typography presets from plugin team.
 * Per key: active page sheet → other sheet (only if key is missing).
 * Never override a key that already exists on the active page sheet.
 */

export const OPENER_STYLES = {
  chapterHeading: {
    font: "Arial",
    size: 15,
    color: "#0074BC",
    bold: false,
  },
  chapterTitle: {
    font: "Arial",
    size: 22,
    color: "#000000",
    bold: false,
  },
  chapterOverview: {
    font: "Arial",
    size: 9,
    color: "#0074BC",
    bold: true,
  },
  lessonOverview: {
    font: "Arial",
    size: 9,
    color: "#000000",
    bold: true,
  },
  lessonTitle: {
    font: "Arial",
    size: 12,
    color: "#0074BC",
    bold: false,
  },
  learningObjectives: {
    font: "Arial",
    size: 9,
    color: "#0074BC",
    bold: true,
  },
  sectionTitle: {
    font: "Arial",
    size: 11,
    color: "#0074BC",
    bold: false,
  },
  subSectionTitle: {
    font: "Arial",
    size: 9,
    color: "#0074BC",
    bold: true,
  },
  paragrapghText: {
    font: "Arial",
    size: 9,
    color: "#000000",
    bold: false,
  },
  bullestList: {
    font: "Arial",
    size: 9,
    color: "#000000",
    bold: false,
  },
  imageFigureNumber: {
    font: "Arial",
    size: 7.5,
    color: "#C31427",
    bold: true,
  },
  imageFigureText: {
    font: "Arial",
    size: 7.5,
    color: "#000000",
    bold: false,
  },
};

export const NON_OPENER_STYLES = {
  partNumber: {
    font: "Arial",
    size: 24,
    color: "#FFFFFF",
    bold: false,
    backgroundColor: "#CA5027",
  },
  chapterHeading: {
    font: "Arial",
    size: 36,
    color: "#FFFFFF",
    bold: false,
    backgroundColor: "#CA5027",
  },
  lessonTitle: {
    font: "Arial",
    size: 44,
    color: "#214880",
    bold: false,
  },
  learningObjectives: {
    font: "Arial",
    size: 15,
    color: "#CA5027",
    bold: true,
  },
  paragraphText: {
    font: "Arial",
    size: 10,
    color: "#000000",
    bold: false,
  },
  subTitlesList: {
    text: {
      font: "Arial",
      size: 11,
      color: "#000000",
      bold: false,
    },
    number: {
      font: "Arial",
      size: 11,
      color: "#CA5027",
      bold: true,
    },
  },
  sectionTitle: {
    text: {
      font: "Arial",
      size: 17,
      color: "#214880",
      bold: true,
    },
    number: {
      font: "Arial",
      size: 18,
      color: "#214880",
      bold: true,
    },
  },
  subSectionTitle: {
    font: "Arial",
    size: 10,
    color: "#000000",
    bold: true,
  },
  greenSubSectionTitle: {
    font: "Arial",
    size: 15,
    color: "#00854A",
    bold: true,
  },
  subTitle: {
    font: "Arial",
    size: 12,
    color: "#CA5027",
    bold: false,
  },
};

const isCompositeStyle = (value) =>
  Boolean(value && typeof value === "object" && value.text && value.number);

const pickRawStyle = (styleSet, keys) => {
  for (const key of keys) {
    const value = styleSet?.[key];
    if (value && typeof value === "object") {
      return value;
    }
  }
  return null;
};

const pickFlatStyle = (styleSet, keys) => {
  const raw = pickRawStyle(styleSet, keys);
  if (!raw) return null;
  return isCompositeStyle(raw) ? raw.text : raw;
};

const normalizeStylePreset = (styleSet = OPENER_STYLES) => {
  const partNumber = pickFlatStyle(styleSet, ["partNumber"]);
  const chapterNumber = pickFlatStyle(styleSet, ["chapterNumber", "chapterHeading"]);
  const chapterHeading = pickFlatStyle(styleSet, ["chapterHeading"]);
  const chapterTitle = pickFlatStyle(styleSet, ["chapterTitle"]);
  const chapterOverview = pickFlatStyle(styleSet, ["chapterOverview"]);
  const lessonOverview = pickFlatStyle(styleSet, ["lessonOverview", "topic"]);
  const lessonTitle = pickFlatStyle(styleSet, ["lessonTitle"]);
  const learningObjectives = pickFlatStyle(styleSet, ["learningObjectives"]);
  const sectionTitleRaw = pickRawStyle(styleSet, ["sectionTitle"]);
  const sectionTitle = isCompositeStyle(sectionTitleRaw)
    ? sectionTitleRaw
    : pickFlatStyle(styleSet, ["sectionTitle"]);
  const subSectionTitle = pickFlatStyle(styleSet, ["subSectionTitle"]);
  const greenSubSectionTitle = pickFlatStyle(styleSet, ["greenSubSectionTitle"]);
  const subTitle = pickFlatStyle(styleSet, ["subTitle"]);
  const subTitlesListRaw = pickRawStyle(styleSet, ["subTitlesList"]);
  const subTitlesList = isCompositeStyle(subTitlesListRaw)
    ? subTitlesListRaw
    : pickFlatStyle(styleSet, ["subTitlesList"]);
  const paragraphText = pickFlatStyle(styleSet, ["paragraphText", "paragrapghText", "text"]);
  const bulletList = pickFlatStyle(styleSet, ["bulletList", "bullestList"]);
  const imageFigureNumber = pickFlatStyle(styleSet, ["imageFigureNumber"]);
  const imageFigureText = pickFlatStyle(styleSet, [
    "imageFigureText",
    "imageCaption",
    "figureCaption",
  ]);

  return {
    chapterHeading,
    chapterTitle,
    chapterOverview,
    lessonOverview,
    lessonTitle,
    learningObjectives,
    sectionTitle,
    subSectionTitle,
    greenSubSectionTitle,
    subTitle,
    subTitlesList,
    paragraphText,
    bulletList,
    imageFigureNumber,
    imageFigureText,
    chapterNumber,
    lessonNumber: chapterHeading,
    topic: lessonOverview,
    text: paragraphText,
    imageCaption: imageFigureText,
    figureCaption: imageFigureText,
    logoText: subSectionTitle,
    partNumber,
  };
};

const fillMissingStyles = (resolved, fallback) => {
  const filled = { ...resolved };
  Object.keys(fallback).forEach((key) => {
    if (!filled[key]) {
      filled[key] = fallback[key];
    }
  });
  return filled;
};

export const STYLE_PRESETS = {
  opener: OPENER_STYLES,
  nonOpener: NON_OPENER_STYLES,
};

/**
 * Resolve styles per key:
 * 1) active page sheet (opener | non-opener) — use as-is when key exists
 * 2) the other sheet — only for keys missing from the active sheet
 */
export const resolveTypographyStyles = (mode = "opener") => {
  const normalizedMode = String(mode || "opener").toLowerCase();
  const isNonOpener =
    normalizedMode === "nonopener" || normalizedMode === "non-opener";

  const primary = normalizeStylePreset(
    isNonOpener ? STYLE_PRESETS.nonOpener : STYLE_PRESETS.opener
  );
  const secondary = normalizeStylePreset(
    isNonOpener ? STYLE_PRESETS.opener : STYLE_PRESETS.nonOpener
  );

  return fillMissingStyles(primary, secondary);
};

export const typographyStyles = resolveTypographyStyles("opener");

export const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
      ]
    : [0, 0, 0];
};

export const toInDesignStyle = (style) => ({
  pointSize: style.size,
  bold: style.bold ?? false,
  italic: style.italic ?? false,
  leftIndent: style.leftIndent ?? 0,
  color: hexToRgb(style.color),
});

export const toCssVariables = (key, style) => {
  if (!style) return {};

  if (isCompositeStyle(style)) {
    return {
      ...toCssVariables(key, style.text),
      ...toCssVariables(`${key}Number`, style.number),
    };
  }

  const prefix = `--typography-${key}`;
  return {
    [`${prefix}-font`]: `${style.font || "Arial"}, sans-serif`,
    [`${prefix}-size`]: `${style.size}pt`,
    [`${prefix}-color`]: style.color,
    ...(style.backgroundColor ? { [`${prefix}-bg`]: style.backgroundColor } : {}),
    [`${prefix}-weight`]: style.bold ? "700" : "400",
    [`${prefix}-style`]: style.italic ? "italic" : "normal",
  };
};

export const generateAllCssVariables = (styles = typographyStyles) => {
  const variables = {};
  Object.entries(styles).forEach(([key, style]) => {
    Object.assign(variables, toCssVariables(key, style));
  });
  return variables;
};

export const blockTypeToStyleKey = {
  ChapterNumber: "chapterNumber",
  PartNumber: "partNumber",
  ChapterHeading: "chapterHeading",
  ChapterTitle: "chapterTitle",
  ChapterOverview: "chapterOverview",
  LessonNumber: "lessonNumber",
  LessonTitle: "lessonTitle",
  LessonOverview: "lessonOverview",
  SectionTitle: "sectionTitle",
  SubSectionTitle: "subSectionTitle",
  GreenSubSectionTitle: "greenSubSectionTitle",
  SubTitle: "subTitle",
  SubTitlesList: "subTitlesList",
  LearningObjectives: "learningObjectives",
  ParagraphText: "paragraphText",
  Text: "text",
  BulletList: "bulletList",
  Image: "imageCaption",
  FigureCaption: "figureCaption",
  LogoWithText: "logoText",
  Topic: "topic",
};

export const getStyleForBlockType = (blockType) => {
  const styleKey = blockTypeToStyleKey[blockType];
  return styleKey ? typographyStyles[styleKey] : null;
};

export default typographyStyles;
