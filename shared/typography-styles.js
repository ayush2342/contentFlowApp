/**
 * Centralized Typography Configuration
 * 
 * This is the single source of truth for text styling across both
 * digital output (web) and PDF generation (InDesign).
 * 
 * All block types that appear in the JSON content should have their
 * styling defined here. Changes here will automatically propagate to
 * both rendering outputs.
 */

export const typographyStyles = {
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
  paragraphText: {
    font: "Arial",
    size: 9,
    color: "#000000",
    bold: false,
  },
  bulletList: {
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
  // Additional block types used in the system
  lessonNumber: {
    font: "Arial",
    size: 14,
    color: "#0074BC",
    bold: false,
  },
  chapterNumber: {
    font: "Arial",
    size: 14,
    color: "#0074BC",
    bold: false,
  },
  topic: {
    font: "Arial",
    size: 11,
    color: "#000000",
    bold: true,
  },
  text: {
    font: "Arial",
    size: 9,
    color: "#000000",
    bold: false,
  },
  imageCaption: {
    font: "Arial",
    size: 7.5,
    color: "#000000",
    bold: false,
  },
  figureCaption: {
    font: "Arial",
    size: 7.5,
    color: "#404040",
    bold: false,
    italic: true,
  },
  logoText: {
    font: "Arial",
    size: 11,
    color: "#0074BC",
    bold: true,
  },
};

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
export const generateAllCssVariables = () => {
  const variables = {};
  Object.entries(typographyStyles).forEach(([key, style]) => {
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
