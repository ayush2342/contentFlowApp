import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import {
  DEFAULT_FORMAT_ID,
  normalizeAppearanceId,
  resolveLayoutFormat,
  templateIdToFormatId,
} from '../../../shared/layout-formats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const themesDir = path.resolve(__dirname, '../../../shared/themes');
const formatsDir = path.resolve(__dirname, '../../../shared/formats');

const s3Client = new S3Client({
  region: env.awsRegion,
  credentials: {
    accessKeyId: env.awsAccessKeyId,
    secretAccessKey: env.awsSecretAccessKey,
  },
});

const applyKeyTemplate = (template, { envName, id }) => {
  if (!template) return null;
  const safeEnv = String(envName || 'dev');
  const safeId = String(id || '');
  return template
    .replaceAll('{env}', safeEnv)
    .replaceAll('{prefix}', safeEnv)
    .replaceAll('{id}', safeId)
    .replaceAll('{themeId}', safeId)
    .replaceAll('{formatId}', safeId)
    .replaceAll('{templateId}', safeId);
};

/** Safe numeric theme id: theme1|1 → "1" (no path traversal). */
export const sanitizeThemeId = (templateId) => {
  const id = normalizeAppearanceId(templateId, null);
  if (!id || !/^\d+$/.test(id)) return null;
  return id;
};

export const resolveLocalThemeId = (templateId) =>
  sanitizeThemeId(templateId) ||
  normalizeAppearanceId(env.defaultThemeId, '2') ||
  '2';

/**
 * Theme S3 key: {env}/appearance/theme/{id}.json → …/theme/2.json
 */
export const buildThemeS3Key = ({ templateId } = {}) =>
  applyKeyTemplate(env.themeS3KeyTemplate, {
    envName: env.requestPrefix || 'dev',
    id: resolveLocalThemeId(templateId),
  });

/**
 * Format S3 key: {env}/appearance/format/{id}.json → …/format/2.json
 * theme2|2 → format id 2 by convention.
 */
export const buildFormatS3Key = ({ templateId, formatId } = {}) => {
  const id = formatId
    ? normalizeAppearanceId(formatId, '2')
    : templateIdToFormatId(templateId);
  return applyKeyTemplate(env.formatS3KeyTemplate, {
    envName: env.requestPrefix || 'dev',
    id,
  });
};

/** @deprecated Use buildThemeS3Key */
export const buildStylesheetS3Key = buildThemeS3Key;

/**
 * Format sheets have page-level `columns` under opener/non-opener.
 * Theme sheets (legacy) also use opener/non-opener but hold typography (font/size/color) — not layout.
 */
const isFormatLayoutDocument = (document) => {
  if (!document || typeof document !== 'object') return false;
  const opener = document.opener;
  return Boolean(opener && typeof opener === 'object' && opener.columns != null);
};

const extractEmbeddedLayout = (document) => {
  if (!document || typeof document !== 'object') return null;
  if (document.layout || document.FORMAT || document.format) {
    return document.layout || document.FORMAT || document.format;
  }
  if (isFormatLayoutDocument(document)) return document;
  return null;
};

/** PascalCase / plugin keys → camelCase STYLES keys used by web + PDF. */
const LEGACY_THEME_KEY_MAP = {
  ChapterNumber: 'chapterNumber',
  ChapterHeading: 'chapterHeading',
  ChapterTitle: 'chapterTitle',
  ChapterOverview: 'chapterOverview',
  LessonOverview: 'lessonOverview',
  LessonTitle: 'lessonTitle',
  LessonNumber: 'lessonNumber',
  SectionTitle: 'sectionTitle',
  SubSectionTitle: 'subSectionTitle',
  GreenSubSectionTitle: 'greenSubSectionTitle',
  LearningObjectives: 'learningObjectives',
  PartNumber: 'partNumber',
  SubTitlesList: 'subTitlesList',
  SubTitle: 'subTitle',
  ParagraphText: 'paragraphText',
  BulletList: 'bulletList',
  Quotation: 'quotation',
  Table: 'table',
  Footer: 'footer',
};

/**
 * Normalize theme JSON into a flat STYLES map.
 * Supports:
 * - local/new: { themeId, STYLES: { chapterNumber: … } }
 * - S3/legacy: { opener: { ChapterNumber: … }, "non-opener": { … } }
 */
export const extractThemeStylesMap = (document) => {
  if (!document || typeof document !== 'object') return null;

  if (document.STYLES && typeof document.STYLES === 'object') {
    return document.STYLES;
  }

  // Legacy dual-mode theme: prefer opener styles as the shared map.
  const legacySource =
    document.opener && typeof document.opener === 'object' && document.opener.columns == null
      ? document.opener
      : document['non-opener'] &&
          typeof document['non-opener'] === 'object' &&
          document['non-opener'].columns == null
        ? document['non-opener']
        : null;

  if (!legacySource) return null;

  const styles = {};
  for (const [rawKey, value] of Object.entries(legacySource)) {
    if (!value || typeof value !== 'object') continue;
    if (rawKey === 'columns') continue;

    if (rawKey === 'Image' || rawKey === 'image') {
      const caption = value.Caption || value.caption || value;
      if (caption?.figureNumber) styles.imageFigureNumber = caption.figureNumber;
      if (caption?.figureText) styles.imageFigureText = caption.figureText;
      continue;
    }

    const mapped =
      LEGACY_THEME_KEY_MAP[rawKey] ||
      (rawKey.charAt(0).toLowerCase() + rawKey.slice(1));
    styles[mapped] = value;
  }

  return Object.keys(styles).length ? styles : null;
};

const loadJsonFromS3 = async (key) => {
  const result = await s3Client.send(
    new GetObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
    })
  );
  const chunks = [];
  for await (const chunk of result.Body) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
};

const loadLocalFormatDocument = async (templateId) => {
  const formatId = templateIdToFormatId(templateId);
  const filePath = path.join(formatsDir, `${formatId}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return { formatId, source: 'local', layout: JSON.parse(raw), key: filePath };
  } catch {
    const fallbackId = env.defaultFormatId || DEFAULT_FORMAT_ID;
    const fallbackPath = path.join(formatsDir, `${fallbackId}.json`);
    const raw = await fs.readFile(fallbackPath, 'utf8');
    return {
      formatId: fallbackId,
      source: 'local',
      layout: JSON.parse(raw),
      key: fallbackPath,
    };
  }
};

const loadFormatFromS3OrLocal = async (templateId) => {
  const formatId = templateIdToFormatId(templateId);
  const s3Key = buildFormatS3Key({ formatId });

  if (s3Key) {
    try {
      const document = await loadJsonFromS3(s3Key);
      const layout = extractEmbeddedLayout(document) || document;
      console.info(`[format] loaded from S3: ${s3Key}`);
      return {
        formatId: normalizeAppearanceId(document.formatId || formatId, formatId),
        source: 's3',
        layout,
        key: s3Key,
      };
    } catch (error) {
      console.warn(
        `[format] S3 fetch failed for "${s3Key}" (${error.message}); falling back to local format`
      );
    }
  }

  return loadLocalFormatDocument(templateId);
};

const attachLayout = async (stylesheetResult) => {
  const embedded = extractEmbeddedLayout(stylesheetResult.document);
  if (embedded) {
    const resolved = resolveLayoutFormat(stylesheetResult.templateId, embedded);
    return {
      ...stylesheetResult,
      formatId: resolved.formatId,
      layoutSource: 's3-embedded',
      layout: resolved.layout,
    };
  }

  const formatResult = await loadFormatFromS3OrLocal(stylesheetResult.templateId);
  return {
    ...stylesheetResult,
    formatId: formatResult.formatId,
    layoutSource: formatResult.source,
    layout: formatResult.layout,
  };
};

const loadLocalThemeDocument = async (templateId) => {
  const themeFileId = resolveLocalThemeId(templateId);
  const filePath = path.join(themesDir, `${themeFileId}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  return {
    source: 'local',
    templateId: themeFileId,
    themeId: themeFileId,
    key: filePath,
    document: JSON.parse(raw),
  };
};

const loadThemeFromS3 = async (key, templateId) => {
  const document = await loadJsonFromS3(key);
  const themeId = resolveLocalThemeId(document.themeId || templateId);
  return {
    source: 's3',
    templateId: resolveLocalThemeId(templateId),
    themeId,
    key,
    document,
  };
};

/**
 * Resolve theme + format using templateId:
 * 1) Theme from S3 {env}/appearance/theme/{id}.json, else local themes/
 * 2) Format from S3 {env}/appearance/format/{id}.json (or embedded in theme), else local formats/
 */
export const resolveStylesheet = async ({ templateId } = {}) => {
  const requestedTemplateId = resolveLocalThemeId(templateId);
  const themeKey = buildThemeS3Key({ templateId: requestedTemplateId });

  if (themeKey) {
    try {
      const fromS3 = await loadThemeFromS3(themeKey, requestedTemplateId);
      console.info(`[theme] loaded from S3: ${themeKey}`);
      return attachLayout(fromS3);
    } catch (error) {
      console.warn(
        `[theme] S3 fetch failed for "${themeKey}" (${error.message}); falling back to local theme for templateId=${requestedTemplateId}`
      );
    }
  }

  try {
    const localTheme = await loadLocalThemeDocument(requestedTemplateId);
    return attachLayout(localTheme);
  } catch (localError) {
    const fallback = normalizeAppearanceId(env.defaultThemeId, '2');
    console.warn(
      `[theme] local theme for "${requestedTemplateId}" missing (${localError.message}); using ${fallback}`
    );
    return attachLayout(await loadLocalThemeDocument(fallback));
  }
};

export const toPdfTypographyConfig = (stylesheetResult) => {
  const doc = stylesheetResult?.document || {};
  const themeId = normalizeAppearanceId(
    doc.themeId || stylesheetResult?.themeId || env.defaultThemeId,
    '2'
  );
  const styles = extractThemeStylesMap(doc) || (doc.STYLES ? doc.STYLES : null) || {};

  return {
    templateId: stylesheetResult?.templateId,
    themeId,
    STYLES: styles,
    formatId: stylesheetResult?.formatId || templateIdToFormatId(stylesheetResult?.templateId),
    layout: stylesheetResult?.layout || null,
  };
};
