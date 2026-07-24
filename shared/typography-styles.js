/**
 * Theme-aware typography for web + PDF.
 * Local themes: any shared/themes/{templateId}.json (theme1, theme2, theme3, …).
 * Runtime may override via S3 (backend stylesheetService); default theme is theme2.
 */

const themeModules = import.meta.glob('./themes/*.json', {
  eager: true,
  import: 'default',
});

const buildLocalThemes = () => {
  const themes = {};
  for (const [filePath, doc] of Object.entries(themeModules)) {
    const id = filePath
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.json$/i, '')
      ?.toLowerCase();
    if (id) themes[id] = doc;
  }
  return themes;
};

export const LOCAL_THEMES = buildLocalThemes();

export const DEFAULT_THEME_ID =
  LOCAL_THEMES.theme2 ? 'theme2' : Object.keys(LOCAL_THEMES)[0] || 'theme2';

const sanitizeThemeId = (templateId) => {
  const raw = String(templateId || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');
  if (!raw || !/^[a-z0-9-]+$/.test(raw)) return null;
  return raw;
};

const extractStyles = (themeDoc) => {
  if (!themeDoc || typeof themeDoc !== 'object') return null;
  if (themeDoc.STYLES && typeof themeDoc.STYLES === 'object') return themeDoc.STYLES;
  return themeDoc;
};

export const listLocalThemeIds = () => Object.keys(LOCAL_THEMES);

export const getLocalThemeDocument = (templateId = DEFAULT_THEME_ID) => {
  const id = sanitizeThemeId(templateId) || DEFAULT_THEME_ID;
  return LOCAL_THEMES[id] || LOCAL_THEMES[DEFAULT_THEME_ID] || null;
};

export const getLocalThemeStyles = (themeId = DEFAULT_THEME_ID) =>
  extractStyles(getLocalThemeDocument(themeId)) ||
  extractStyles(LOCAL_THEMES[DEFAULT_THEME_ID]);

/** Active styles for the default theme. */
export const TYPOGRAPHY_STYLES = getLocalThemeStyles(DEFAULT_THEME_ID);

/** @deprecated Kept for older callers — both point at the active default theme. */
export const OPENER_STYLES = TYPOGRAPHY_STYLES;
/** @deprecated Kept for older callers — both point at the active default theme. */
export const NON_OPENER_STYLES = TYPOGRAPHY_STYLES;

const isCompositeStyle = (value) =>
  Boolean(value && typeof value === 'object' && value.text && value.number);

const pickRawStyle = (styleSet, keys) => {
  for (const key of keys) {
    const value = styleSet?.[key];
    if (value && typeof value === 'object') {
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

export const normalizeStylePreset = (styleSet = TYPOGRAPHY_STYLES) => {
  const partNumber = pickFlatStyle(styleSet, ['partNumber']);
  const chapterNumber = pickFlatStyle(styleSet, ['chapterNumber', 'chapterHeading']);
  const chapterHeading = pickFlatStyle(styleSet, ['chapterHeading', 'chapterNumber']);
  const chapterTitle = pickFlatStyle(styleSet, ['chapterTitle']);
  const chapterOverview = pickFlatStyle(styleSet, ['chapterOverview']);
  const lessonOverviewRaw = pickRawStyle(styleSet, ['lessonOverview', 'topic']);
  const lessonOverview = isCompositeStyle(lessonOverviewRaw)
    ? lessonOverviewRaw
    : pickFlatStyle(styleSet, ['lessonOverview', 'topic']);
  const lessonTitle = pickFlatStyle(styleSet, ['lessonTitle']);
  const learningObjectives = pickFlatStyle(styleSet, ['learningObjectives']);
  const sectionTitleRaw = pickRawStyle(styleSet, ['sectionTitle']);
  const sectionTitle = isCompositeStyle(sectionTitleRaw)
    ? sectionTitleRaw
    : pickFlatStyle(styleSet, ['sectionTitle']);
  const subSectionTitle = pickFlatStyle(styleSet, ['subSectionTitle']);
  const greenSubSectionTitle = pickFlatStyle(styleSet, ['greenSubSectionTitle', 'subSectionTitle']);
  const subTitle = pickFlatStyle(styleSet, ['subTitle']);
  const subTitlesListRaw = pickRawStyle(styleSet, ['subTitlesList', 'lessonOverview']);
  const subTitlesList = isCompositeStyle(subTitlesListRaw)
    ? subTitlesListRaw
    : pickFlatStyle(styleSet, ['subTitlesList']);
  const paragraphText = pickFlatStyle(styleSet, ['paragraphText', 'paragrapghText', 'text']);
  const bulletList = pickFlatStyle(styleSet, ['bulletList', 'bullestList', 'paragraphText']);
  const imageFigureNumber = pickFlatStyle(styleSet, ['imageFigureNumber']);
  const imageFigureText = pickFlatStyle(styleSet, [
    'imageFigureText',
    'imageCaption',
    'figureCaption',
  ]);
  const quotationRaw = pickRawStyle(styleSet, ['quotation', 'quote']);
  const tableRaw = pickRawStyle(styleSet, ['table']);
  const footer = pickFlatStyle(styleSet, ['footer']);

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
    topic: isCompositeStyle(lessonOverview) ? lessonOverview.text : lessonOverview,
    text: paragraphText,
    imageCaption: imageFigureText,
    figureCaption: imageFigureText,
    logoText: subSectionTitle,
    partNumber,
    quotation: quotationRaw,
    table: tableRaw,
    footer,
  };
};

export const STYLE_PRESETS = Object.fromEntries(
  Object.keys(LOCAL_THEMES).map((id) => [id, getLocalThemeStyles(id)])
);

/**
 * Resolve styles for a templateId (theme1, theme2, theme3, …).
 * Legacy opener/non-opener args map to the default theme.
 */
export const resolveTypographyStyles = (templateIdOrMode = DEFAULT_THEME_ID) => {
  const raw = String(templateIdOrMode || DEFAULT_THEME_ID).toLowerCase();
  if (raw === 'opener' || raw === 'non-opener' || raw === 'nonopener') {
    return normalizeStylePreset(getLocalThemeStyles(DEFAULT_THEME_ID));
  }
  return normalizeStylePreset(getLocalThemeStyles(raw));
};

/** Prefer API/S3 theme document STYLES when present; otherwise local theme files. */
export const resolveTypographyStylesFromPayload = (
  typographyPayload,
  templateId = DEFAULT_THEME_ID
) => {
  const fromPayload = extractStyles(typographyPayload);
  if (fromPayload && typeof fromPayload === 'object' && Object.keys(fromPayload).length) {
    return normalizeStylePreset(fromPayload);
  }
  return resolveTypographyStyles(templateId);
};

export const typographyStyles = resolveTypographyStyles(DEFAULT_THEME_ID);

export const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
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

  // Quotation: text + author + shared backgroundColor
  if (style.text && style.author && typeof style.text === 'object') {
    return {
      ...toCssVariables(`${key}Text`, style.text),
      ...toCssVariables(`${key}Author`, style.author),
      [`--typography-${key}-bg`]: style.backgroundColor || 'transparent',
    };
  }

  // Table: headingText / subHeadingText / rowsText (+ alt row bg)
  if (style.headingText || style.rowsText) {
    const vars = {
      ...toCssVariables(`${key}Heading`, style.headingText),
      ...toCssVariables(`${key}SubHeading`, style.subHeadingText),
      ...toCssVariables(`${key}Rows`, style.rowsText),
    };
    const altBg =
      style.rowsText?.altBackgroundColor ||
      style.rowsText?.altbackgroundColor ||
      style.rowsText?.BackgroundColor;
    if (style.rowsText?.backgroundColor) {
      vars[`--typography-${key}Rows-bg`] = style.rowsText.backgroundColor;
    }
    if (altBg) {
      vars[`--typography-${key}Rows-alt-bg`] = altBg;
    }
    return vars;
  }

  const prefix = `--typography-${key}`;
  return {
    [`${prefix}-font`]: `${style.font || 'Arial'}, sans-serif`,
    [`${prefix}-size`]: `${style.size}pt`,
    [`${prefix}-color`]: style.color,
    // Always set bg so a previous theme's badge color cannot stick (e.g. theme2 → theme1).
    [`${prefix}-bg`]: style.backgroundColor || 'transparent',
    ...(style.altBackgroundColor || style.altbackgroundColor
      ? {
          [`${prefix}-alt-bg`]:
            style.altBackgroundColor || style.altbackgroundColor,
        }
      : { [`${prefix}-alt-bg`]: 'transparent' }),
    [`${prefix}-weight`]: style.bold ? '700' : '400',
    [`${prefix}-style`]: style.italic ? 'italic' : 'normal',
    ...(style.textTransform
      ? { [`${prefix}-transform`]: style.textTransform }
      : {}),
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
  ChapterNumber: 'chapterNumber',
  PartNumber: 'partNumber',
  ChapterHeading: 'chapterHeading',
  ChapterTitle: 'chapterTitle',
  ChapterOverview: 'chapterOverview',
  LessonNumber: 'lessonNumber',
  LessonTitle: 'lessonTitle',
  LessonOverview: 'lessonOverview',
  SectionTitle: 'sectionTitle',
  SubSectionTitle: 'subSectionTitle',
  GreenSubSectionTitle: 'greenSubSectionTitle',
  SubTitle: 'subTitle',
  SubTitlesList: 'subTitlesList',
  LearningObjectives: 'learningObjectives',
  ParagraphText: 'paragraphText',
  Text: 'text',
  BulletList: 'bulletList',
  Image: 'imageCaption',
  FigureCaption: 'figureCaption',
  LogoWithText: 'logoText',
  Topic: 'topic',
  Quotation: 'quotation',
  Quote: 'quotation',
  Table: 'table',
  Footer: 'footer',
};

export const getStyleForBlockType = (blockType, themeId = DEFAULT_THEME_ID) => {
  const styleKey = blockTypeToStyleKey[blockType];
  const styles = resolveTypographyStyles(themeId);
  return styleKey ? styles[styleKey] : null;
};

export default typographyStyles;

