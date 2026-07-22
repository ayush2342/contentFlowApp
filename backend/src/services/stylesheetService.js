import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import {
  DEFAULT_FORMAT_ID,
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

/** Safe theme file id: theme1, theme2, theme3, … (no path traversal). */
export const sanitizeThemeId = (templateId) => {
  const raw = String(templateId || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');
  if (!raw || !/^[a-z0-9-]+$/.test(raw)) return null;
  return raw;
};

export const resolveLocalThemeId = (templateId) =>
  sanitizeThemeId(templateId) || env.defaultThemeId || 'theme2';

/**
 * Theme S3 key: {env}/appearance/theme/{id}.json
 */
export const buildThemeS3Key = ({ templateId } = {}) =>
  applyKeyTemplate(env.themeS3KeyTemplate, {
    envName: env.requestPrefix || 'dev',
    id: resolveLocalThemeId(templateId),
  });

/**
 * Format S3 key: {env}/appearance/format/{id}.json
 * theme2 → format2 by convention.
 */
export const buildFormatS3Key = ({ templateId, formatId } = {}) => {
  const id = formatId || templateIdToFormatId(templateId);
  return applyKeyTemplate(env.formatS3KeyTemplate, {
    envName: env.requestPrefix || 'dev',
    id,
  });
};

/** @deprecated Use buildThemeS3Key */
export const buildStylesheetS3Key = buildThemeS3Key;

const extractEmbeddedLayout = (document) => {
  if (!document || typeof document !== 'object') return null;
  if (document.layout || document.FORMAT || document.format) {
    return document.layout || document.FORMAT || document.format;
  }
  if (document.opener || document['non-opener']) return document;
  return null;
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
        formatId: document.formatId || formatId,
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
  const themeId = document.themeId || resolveLocalThemeId(templateId);
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
    const fallback = env.defaultThemeId || 'theme2';
    console.warn(
      `[theme] local theme for "${requestedTemplateId}" missing (${localError.message}); using ${fallback}`
    );
    return attachLayout(await loadLocalThemeDocument(fallback));
  }
};

export const toPdfTypographyConfig = (stylesheetResult) => {
  const doc = stylesheetResult?.document || {};
  const themeId =
    doc.themeId || stylesheetResult?.themeId || env.defaultThemeId || 'theme2';
  const base = doc.STYLES
    ? {
        templateId: stylesheetResult.templateId,
        themeId,
        STYLES: doc.STYLES,
      }
    : {
        templateId: stylesheetResult?.templateId,
        themeId,
        STYLES: doc,
      };

  return {
    ...base,
    formatId: stylesheetResult?.formatId || templateIdToFormatId(stylesheetResult?.templateId),
    layout: stylesheetResult?.layout || null,
  };
};
