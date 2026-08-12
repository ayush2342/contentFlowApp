/**
 * Layout formats (column rules) for web + PDF.
 * Local formats: any shared/formats/{n}.json (1, 2, 3, …).
 * Resolved from templateId: theme2|format2|2 → 2. Default: 2.
 * S3 stylesheet may embed layout under `layout` / `FORMAT` / `format`.
 *
 * Backend also loads formats from disk by id (not limited to this bundle).
 */

const formatModules =
  typeof import.meta.glob === 'function'
    ? import.meta.glob('./formats/*.json', { eager: true, import: 'default' })
    : {};

const buildLocalFormats = () => {
  const formats = {};
  for (const [filePath, doc] of Object.entries(formatModules)) {
    const id = filePath
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.json$/i, '')
      ?.toLowerCase();
    if (id) formats[id] = doc;
  }
  return formats;
};

export const LOCAL_FORMATS = buildLocalFormats();

export const DEFAULT_FORMAT_ID =
  LOCAL_FORMATS['2'] ? '2' : Object.keys(LOCAL_FORMATS)[0] || '2';

export const listLocalFormatIds = () => Object.keys(LOCAL_FORMATS);

/**
 * Normalize appearance ids for S3 + local files.
 * theme1 / "theme 1" / format1 / 1 → "1"; theme2 / 2 → "2".
 * Always strips theme/format prefix — never looks up theme1.json / format1.json.
 */
export const normalizeAppearanceId = (value, fallback = DEFAULT_FORMAT_ID) => {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');
  if (!raw) return fallback;
  const prefixed = raw.match(/^(?:theme|format)[-]?(\d+)$/);
  if (prefixed) return prefixed[1];
  if (/^\d+$/.test(raw)) return raw;
  return fallback;
};

/**
 * Map templateId → format id (numeric): theme3|format3|3 → "3".
 */
export const templateIdToFormatId = (templateId) =>
  normalizeAppearanceId(templateId, DEFAULT_FORMAT_ID);

export const getLocalFormatDocument = (templateIdOrFormatId = DEFAULT_FORMAT_ID) => {
  const formatId = templateIdToFormatId(templateIdOrFormatId);
  return LOCAL_FORMATS[formatId] || LOCAL_FORMATS[DEFAULT_FORMAT_ID] || null;
};

const PAGE_TYPE_KEYS = {
  opener: 'opener',
  'non-opener': 'non-opener',
  nonopener: 'non-opener',
};

export const normalizePageTypeKey = (pageType) => {
  const raw = String(pageType || 'opener')
    .trim()
    .toLowerCase();
  return PAGE_TYPE_KEYS[raw] || 'opener';
};

/** Document content types → format sheet keys (aliases only; unknown keys pass through). */
const CONTENT_TYPE_TO_FORMAT_KEY = {
  ChapterNumber: 'ChapterNumber',
  ChapterHeading: 'ChapterNumber',
  ChapterTitle: 'ChapterTitle',
  ChapterOverview: 'ChapterOverview',
  LessonOverview: 'LessonOverview',
  LessonTitle: 'LessonTitle',
  SectionTitle: 'SectionTitle',
  SubSectionTitle: 'SubSectionTitle',
  GreenSubSectionTitle: 'SubSectionTitle',
  SubSectionHeading: 'SubSectionHeading',
  SubTitle: 'SubSectionTitle',
  ParagraphText: 'ParagraphText',
  Text: 'ParagraphText',
  PartNumber: 'PartNumber',
  Figure: 'Figure',
  Image: 'Figure',
  FigureCaption: 'Figure',
  LearningObjectives: 'LessonOverview',
  BulletList: 'BulletList',
  NumberedList: 'NumberedList',
  Quotation: 'Quotation',
  Quote: 'Quotation',
  Table: 'Table',
  Footer: 'Footer',
};

export const toFormatContentKey = (contentType) => {
  const raw = String(contentType || '').trim();
  if (!raw) return null;
  if (CONTENT_TYPE_TO_FORMAT_KEY[raw]) return CONTENT_TYPE_TO_FORMAT_KEY[raw];
  const found = Object.keys(CONTENT_TYPE_TO_FORMAT_KEY).find(
    (key) => key.toLowerCase() === raw.toLowerCase()
  );
  return found ? CONTENT_TYPE_TO_FORMAT_KEY[found] : raw;
};

export const getPageFormat = (formatDoc, pageType) => {
  const key = normalizePageTypeKey(pageType);
  const section = formatDoc?.[key];
  if (section && typeof section === 'object') return section;
  return formatDoc?.opener || { columns: 1 };
};

export const getPageColumns = (formatDoc, pageType) => {
  const pageFormat = getPageFormat(formatDoc, pageType);
  const columns = Number(pageFormat?.columns);
  return columns === 2 ? 2 : 1;
};

export const getComponentColumns = (formatDoc, pageType, contentType) => {
  const pageFormat = getPageFormat(formatDoc, pageType);
  const pageColumns = getPageColumns(formatDoc, pageType);
  const formatKey = toFormatContentKey(contentType);
  const entry = formatKey ? pageFormat?.[formatKey] : null;
  const columns = Number(entry?.columns);
  if (columns === 2) return 2;
  if (columns === 1) return 1;
  return pageColumns;
};

/**
 * Prefer layout embedded on an S3/theme document; else local format file.
 */
export const resolveLayoutFormat = (templateId, embeddedLayout = null) => {
  const formatId = templateIdToFormatId(templateId);

  let layout = embeddedLayout;
  if (layout && typeof layout === 'object') {
    if (!layout.opener && !layout['non-opener']) {
      layout = layout.layout || layout.FORMAT || layout.format || null;
    }
  }

  if (layout?.opener || layout?.['non-opener']) {
    return {
      formatId: layout.formatId || formatId,
      source: 'embedded',
      layout,
    };
  }

  const local = getLocalFormatDocument(formatId);
  return {
    formatId: local?.formatId || formatId,
    source: 'local',
    layout: local,
  };
};

export default getLocalFormatDocument;
