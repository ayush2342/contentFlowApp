/**
 * Theme-aware typography for web + PDF.
 * Local themes: any shared/themes/{n}.json (1, 2, 3, …).
 * Runtime may override via S3 (backend stylesheetService); default theme is 2.
 * Incoming templateId may be theme2, 2, etc. — normalized to numeric id.
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
  LOCAL_THEMES['2'] ? '2' : Object.keys(LOCAL_THEMES)[0] || '2';

/**
 * Normalize appearance ids: theme1 / "theme 1" / 1 → "1"; theme2 / 2 → "2".
 * Strips theme/format prefix so S3/local always use {n}.json.
 */
export const normalizeThemeId = (templateId, fallback = DEFAULT_THEME_ID) => {
  const raw = String(templateId || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');
  if (!raw) return fallback;
  const prefixed = raw.match(/^(?:theme|format)[-]?(\d+)$/);
  if (prefixed) return prefixed[1];
  if (/^\d+$/.test(raw)) return raw;
  return fallback;
};

const sanitizeThemeId = (templateId) => {
  const id = normalizeThemeId(templateId, null);
  return id;
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
  const greenSubSectionTitle = pickFlatStyle(styleSet, ['greenSubSectionTitle']);
  const subTitle = pickFlatStyle(styleSet, ['subTitle']);
  const subTitlesListRaw = pickRawStyle(styleSet, ['subTitlesList']);
  const subTitlesList = isCompositeStyle(subTitlesListRaw)
    ? subTitlesListRaw
    : pickFlatStyle(styleSet, ['subTitlesList']);
  const paragraphText = pickFlatStyle(styleSet, ['paragraphText', 'paragrapghText', 'text']);
  // Only resolve list/heading keys when the theme defines them — no inventing from other styles.
  const bulletList = pickFlatStyle(styleSet, ['bulletList', 'bullestList']);
  const numberedList = pickFlatStyle(styleSet, ['numberedList']);
  const imageFigureNumber = pickFlatStyle(styleSet, ['imageFigureNumber']);
  const imageFigureText = pickFlatStyle(styleSet, [
    'imageFigureText',
    'imageCaption',
    'figureCaption',
  ]);
  const quotationRaw = pickRawStyle(styleSet, ['quotation', 'quote']);
  const tableRaw = pickRawStyle(styleSet, ['table']);
  const footer = pickFlatStyle(styleSet, ['footer']);
  const subSectionHeading = pickFlatStyle(styleSet, ['subSectionHeading', 'subsectionHeading']);
  const logoWithText = pickFlatStyle(styleSet, ['logoWithText', 'logoText']);

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
    subSectionHeading,
    subTitle,
    subTitlesList,
    paragraphText,
    bulletList,
    numberedList,
    imageFigureNumber,
    imageFigureText,
    chapterNumber,
    lessonNumber: chapterHeading,
    topic: isCompositeStyle(lessonOverview) ? lessonOverview.text : lessonOverview,
    text: paragraphText,
    imageCaption: imageFigureText,
    figureCaption: imageFigureText,
    logoText: logoWithText || subSectionTitle,
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
  return normalizeStylePreset(getLocalThemeStyles(normalizeThemeId(templateIdOrMode)));
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

const FONT_STYLE_SUFFIX_WEIGHTS = {
  thin: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  book: 400,
  regular: 400,
  roman: 400,
  medium: 500,
  semi: 600,
  semibold: 600,
  demibold: 600,
  bold: 700,
  black: 900,
  heavy: 900,
};

/**
 * Theme fonts are named the way designers get them ("Mulish SemiBold").
 * The browser needs the base family plus a numeric weight, so split the
 * style suffix off and keep the full name first for locally installed fonts.
 */
export const toWebFont = (font) => {
  const families = String(font || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!families.length) {
    return { stack: 'Arial, sans-serif', weight: null };
  }

  const [primary, ...rest] = families;
  const match = /^(.*?)[\s-]+(thin|extra\s?light|ultra\s?light|light|book|regular|roman|medium|semi\s?bold|demi\s?bold|semi|bold|black|heavy)$/i.exec(
    primary
  );

  const names = [primary];
  let weight = null;

  if (match) {
    const base = match[1].trim();
    const suffix = match[2].toLowerCase().replace(/\s+/g, '');
    weight = FONT_STYLE_SUFFIX_WEIGHTS[suffix] ?? null;
    if (base && base.toLowerCase() !== primary.toLowerCase()) {
      names.push(base);
    }
  }

  // Adobe Fonts installs several of these under their variable family name.
  names.push(`${names[names.length - 1]} Variable`);

  const stack = names
    .concat(rest)
    .map((name) => (/\s/.test(name) ? `"${name}"` : name))
    .concat('sans-serif')
    .join(', ');

  return { stack, weight };
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
      null;
    // Always set so a previous theme's table colors cannot stick.
    vars[`--typography-${key}Rows-bg`] =
      style.rowsText?.backgroundColor || 'transparent';
    vars[`--typography-${key}Rows-alt-bg`] = altBg || 'transparent';
    return vars;
  }

  const prefix = `--typography-${key}`;
  const hasBadgeBackground = Boolean(style.backgroundColor);
  // Chapter number/heading: full-width bar → vertical + slight horizontal pad (left text).
  // Part number and other badges keep compact horizontal pad.
  const isFullWidthBar = key === 'chapterNumber' || key === 'chapterHeading';
  const padValue = !hasBadgeBackground
    ? '0'
    : isFullWidthBar
      ? '0.7rem 0.85rem'
      : '0.08rem 0.55rem';
  const webFont = toWebFont(style.font);
  return {
    [`${prefix}-font`]: webFont.stack,
    [`${prefix}-size`]: `${style.size}pt`,
    [`${prefix}-color`]: style.color,
    // Always set bg so a previous theme's badge color cannot stick (e.g. theme2 → theme1).
    [`${prefix}-bg`]: style.backgroundColor || 'transparent',
    [`${prefix}-alt-bg`]:
      style.altBackgroundColor || style.altbackgroundColor || 'transparent',
    [`${prefix}-pad`]: padValue,
    [`${prefix}-weight`]: style.bold ? '700' : String(webFont.weight || 400),
    [`${prefix}-style`]: style.italic ? 'italic' : 'normal',
    // Always reset transform so theme1 uppercase cannot stick on theme2.
    [`${prefix}-transform`]: style.textTransform || 'none',
    // Optional theme borders (any block). Reset when absent so theme switches stay clean.
    [`${prefix}-border-top`]: style.borderTop || 'none',
    [`${prefix}-border-bottom`]: style.borderBottom || 'none',
    [`${prefix}-pad-block`]:
      style.borderTop || style.borderBottom ? '0.35em' : '0',
  };
};

/**
 * Inline border styles from theme CSS vars for any block/component root.
 * When the theme style has no borders, vars resolve to none / 0.
 */
export const getTypographyBorderStyle = (styleKey) => {
  if (!styleKey) return undefined;
  const prefix = `--typography-${styleKey}`;
  return {
    borderTop: `var(${prefix}-border-top, none)`,
    borderBottom: `var(${prefix}-border-bottom, none)`,
    paddingBlock: `var(${prefix}-pad-block, 0)`,
  };
};

export const generateAllCssVariables = (styles = typographyStyles) => {
  const variables = {};
  Object.entries(styles).forEach(([key, style]) => {
    if (!style) return;
    Object.assign(variables, toCssVariables(key, style));
  });
  const chapterNumberHasBar = Boolean(
    styles?.chapterNumber?.backgroundColor || styles?.chapterHeading?.backgroundColor
  );
  // Theme 2 keeps the existing 1.5rem gap under the chapter bar.
  // Theme 1 is plain text, so that same gap looks like empty space.
  variables['--typography-chapterTitle-space-before'] = chapterNumberHasBar
    ? '1.5rem'
    : '0.35rem';
  const roomyOverview = Boolean(
    styles?.lessonOverview?.text && styles?.lessonOverview?.number
  ) || chapterNumberHasBar;
  variables['--typography-chapterOverview-space-after'] = roomyOverview
    ? '0.5rem'
    : '0.2rem';
  variables['--typography-lessonOverview-space-after'] = roomyOverview
    ? '1rem'
    : '0.2rem';
  // Gap below the final overview item, before body copy resumes.
  variables['--typography-lessonOverview-space-after-last'] = roomyOverview
    ? '1.4rem'
    : '0.9rem';
  return variables;
};

/**
 * Remove previously applied --typography-* inline vars from a root element.
 * Needed when switching themes: keys present only in the previous theme
 * (e.g. quotation/table/partNumber on theme2) would otherwise linger.
 */
export const clearTypographyCssVariables = (root) => {
  if (!root?.style) return;
  const toRemove = [];
  for (let i = 0; i < root.style.length; i += 1) {
    const name = root.style.item(i);
    if (name && name.startsWith('--typography-')) {
      toRemove.push(name);
    }
  }
  toRemove.forEach((name) => root.style.removeProperty(name));
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
  SubSectionHeading: 'subSectionHeading',
  SubTitle: 'subTitle',
  SubTitlesList: 'subTitlesList',
  LearningObjectives: 'learningObjectives',
  ParagraphText: 'paragraphText',
  Text: 'text',
  BulletList: 'bulletList',
  NumberedList: 'numberedList',
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

