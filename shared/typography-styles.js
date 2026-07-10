/**
 * Centralized typography presets supplied by plugin team.
 * A normalized map is derived for web and PDF consumers.
 */

export const OPENER_STYLES = {
  chapterHeading: { font: "Arial", size: 15, color: "#0074BC", bold: false },
  chapterTitle: { font: "Arial", size: 22, color: "#000000", bold: false },
  chapterOverview: { font: "Arial", size: 9, color: "#0074BC", bold: true },
  lessonOverview: { font: "Arial", size: 9, color: "#000000", bold: true },
  lessonTitle: { font: "Arial", size: 12, color: "#0074BC", bold: false },
  learningObjectives: { font: "Arial", size: 9, color: "#0074BC", bold: true },
  sectionTitle: { font: "Arial", size: 11, color: "#0074BC", bold: false },
  subSectionTitle: { font: "Arial", size: 9, color: "#0074BC", bold: true },
  paragrapghText: { font: "Arial", size: 9, color: "#000000", bold: false },
  paragraphText: { font: "Arial", size: 9, color: "#000000", bold: false },
  bullestList: { font: "Arial", size: 9, color: "#000000", bold: false },
  bulletList: { font: "Arial", size: 9, color: "#000000", bold: false },
  imageFigureNumber: { font: "Arial", size: 7.5, color: "#C31427", bold: true },
  imageFigureText: { font: "Arial", size: 7.5, color: "#000000", bold: false },
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
  lessonTitle: { font: "Arial", size: 44, color: "#214880", bold: false },
  learningObjectives: { font: "Arial", size: 15, color: "#CA5027", bold: true },
  paragraphText: { font: "Arial", size: 10, color: "#000000", bold: false },
  subTitlesList: {
    text: { font: "Arial", size: 11, color: "#000000", bold: false },
    number: { font: "Arial", size: 11, color: "#CA5027", bold: true },
  },
  sectionTitle: {
    text: { font: "Arial", size: 17, color: "#214880", bold: true },
    number: { font: "Arial", size: 18, color: "#214880", bold: true },
  },
  subSectionTitle: { font: "Arial", size: 10, color: "#000000", bold: true },
  greenSubSectionTitle: { font: "Arial", size: 15, color: "#00854A", bold: true },
  subTitle: { font: "Arial", size: 12, color: "#CA5027", bold: false },
};

const pickStyle = (styleSet, keys) => {
  for (const key of keys) {
    const value = styleSet?.[key];
    if (value && typeof value === "object") {
      return value.text && typeof value.text === "object" ? value.text : value;
    }
  }
  return null;
};

const normalizeStylePreset = (styleSet = OPENER_STYLES) => {
  const chapterHeading = pickStyle(styleSet, ["chapterHeading"]);
  const chapterTitle = pickStyle(styleSet, ["chapterTitle"]);
  const chapterOverview = pickStyle(styleSet, ["chapterOverview"]);
  const lessonOverview = pickStyle(styleSet, ["lessonOverview", "topic"]);
  const lessonTitle = pickStyle(styleSet, ["lessonTitle"]);
  const learningObjectives = pickStyle(styleSet, ["learningObjectives"]);
  const sectionTitle = pickStyle(styleSet, ["sectionTitle", "subTitlesList"]);
  const subSectionTitle = pickStyle(styleSet, [
    "subSectionTitle",
    "greenSubSectionTitle",
    "subTitle",
  ]);
  const paragraphText = pickStyle(styleSet, ["paragraphText", "paragrapghText", "text"]);
  const bulletList = pickStyle(styleSet, ["bulletList", "bullestList"]);
  const imageFigureNumber = pickStyle(styleSet, ["imageFigureNumber"]);
  const imageFigureText = pickStyle(styleSet, ["imageFigureText", "imageCaption", "figureCaption"]);

  return {
    chapterHeading,
    chapterTitle,
    chapterOverview,
    lessonOverview,
    lessonTitle,
    learningObjectives,
    sectionTitle,
    subSectionTitle,
    paragraphText,
    bulletList,
    imageFigureNumber,
    imageFigureText,
    // Backward-compatible keys currently used by renderers
    chapterNumber: chapterHeading,
    lessonNumber: chapterHeading,
    topic: lessonOverview,
    text: paragraphText,
    imageCaption: imageFigureText,
    figureCaption: imageFigureText,
    logoText: subSectionTitle,
  };
};

export const STYLE_PRESETS = {
  opener: OPENER_STYLES,
  nonOpener: NON_OPENER_STYLES,
};

export const resolveTypographyStyles = (mode = "opener") => {
  const normalizedMode = String(mode || "opener").toLowerCase();
  const preset =
    normalizedMode === "nonopener" || normalizedMode === "non-opener"
      ? STYLE_PRESETS.nonOpener
      : STYLE_PRESETS.opener;

  return normalizeStylePreset(preset);
};

export const typographyStyles = resolveTypographyStyles("opener");

/**
 * Helper to convert hex color to RGB array for InDesign
 * @param {string} hex - Hex color string (e.g., "#0074BC")
 * @returns {number[]} RGB array [r, g, b]
 */
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

/**
 * Convert typography style to InDesign FRAME_STYLES format
 * @param {object} style - Typography style object
 * @returns {object} InDesign-compatible style object
 */
export const toInDesignStyle = (style) => ({
  pointSize: style.size,
  bold: style.bold ?? false,
  italic: style.italic ?? false,
  leftIndent: style.leftIndent ?? 0,
  color: hexToRgb(style.color),
});

/**
 * Convert typography style to CSS custom properties
 * @param {string} key - Style key (e.g., "chapterTitle")
 * @param {object} style - Typography style object
 * @returns {object} Object with CSS variable names and values
 */
export const toCssVariables = (key, style) => {
  if (!style) return {};
  const prefix = `--typography-${key}`;
  return {
    [`${prefix}-font`]: `${style.font}, sans-serif`,
    [`${prefix}-size`]: `${style.size}pt`,
    [`${prefix}-color`]: style.color,
    [`${prefix}-weight`]: style.bold ? "700" : "400",
    [`${prefix}-style`]: style.italic ? "italic" : "normal",
  };
};

/**
 * Generate all CSS variables from typography config
 * @returns {object} Object with all CSS variable names and values
 */
export const generateAllCssVariables = (styles = typographyStyles) => {
  const variables = {};
  Object.entries(styles).forEach(([key, style]) => {
    Object.assign(variables, toCssVariables(key, style));
  });
  return variables;
};

/**
 * Map JSON block types to typography style keys
 */
export const blockTypeToStyleKey = {
  ChapterNumber: 'chapterNumber',
  ChapterTitle: 'chapterTitle',
  ChapterOverview: 'chapterOverview',
  LessonNumber: 'lessonNumber',
  LessonTitle: 'lessonTitle',
  LessonOverview: 'lessonOverview',
  SectionTitle: 'sectionTitle',
  SubSectionTitle: 'subSectionTitle',
  LearningObjectives: 'learningObjectives',
  ParagraphText: 'paragraphText',
  Text: 'text',
  BulletList: 'bulletList',
  Image: 'imageCaption',
  FigureCaption: 'figureCaption',
  LogoWithText: 'logoText',
  Topic: 'topic',
};

/**
 * Get the style for a given block type
 * @param {string} blockType - The JSON block type
 * @returns {object|null} The typography style or null if not found
 */
export const getStyleForBlockType = (blockType) => {
  const styleKey = blockTypeToStyleKey[blockType];
  return styleKey ? typographyStyles[styleKey] : null;
};

export default typographyStyles;
