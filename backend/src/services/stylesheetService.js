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
 * S3 key for stylesheet. Uses templateId from the plugin request.
 * STYLESHEET_S3_KEY_TEMPLATE placeholders: {prefix}, {templateId}
 */
export const buildStylesheetS3Key = ({ templateId } = {}) => {
  const template = env.stylesheetS3KeyTemplate;
  if (!template) return null;

  const id = resolveLocalThemeId(templateId);
  return template
    .replaceAll('{prefix}', env.requestPrefix || 'dev')
    .replaceAll('{templateId}', id)
    .replaceAll('{themeId}', id);
};

const extractEmbeddedLayout = (document) => {
  if (!document || typeof document !== 'object') return null;
  if (document.layout || document.FORMAT || document.format) {
    return document.layout || document.FORMAT || document.format;
  }
  if (document.opener || document['non-opener']) return document;
  return null;
};

const loadLocalFormatDocument = async (templateId) => {
  const formatId = templateIdToFormatId(templateId);
  const filePath = path.join(formatsDir, `${formatId}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return { formatId, source: 'local', layout: JSON.parse(raw), key: filePath };
  } catch {
    const fallbackPath = path.join(formatsDir, `${DEFAULT_FORMAT_ID}.json`);
    const raw = await fs.readFile(fallbackPath, 'utf8');
    return {
      formatId: DEFAULT_FORMAT_ID,
      source: 'local',
      layout: JSON.parse(raw),
      key: fallbackPath,
    };
  }
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

  const localFormat = await loadLocalFormatDocument(stylesheetResult.templateId);
  return {
    ...stylesheetResult,
    formatId: localFormat.formatId,
    layoutSource: localFormat.source,
    layout: localFormat.layout,
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

const loadStylesheetFromS3 = async (key, templateId) => {
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
  const document = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
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
 * Resolve stylesheet + layout using templateId:
 * 1) Try S3 stylesheet (may embed layout)
 * 2) Fall back to local theme + local format (themeN → formatN, default format2)
 */
export const resolveStylesheet = async ({ templateId } = {}) => {
  const requestedTemplateId = resolveLocalThemeId(templateId);
  const s3Key = buildStylesheetS3Key({ templateId: requestedTemplateId });

  if (s3Key) {
    try {
      const fromS3 = await loadStylesheetFromS3(s3Key, requestedTemplateId);
      console.info(`[stylesheet] loaded from S3: ${s3Key}`);
      return attachLayout(fromS3);
    } catch (error) {
      console.warn(
        `[stylesheet] S3 fetch failed for "${s3Key}" (${error.message}); falling back to local theme for templateId=${requestedTemplateId}`
      );
    }
  }

  try {
    const localTheme = await loadLocalThemeDocument(requestedTemplateId);
    return attachLayout(localTheme);
  } catch (localError) {
    const fallback = env.defaultThemeId || 'theme2';
    console.warn(
      `[stylesheet] local theme for "${requestedTemplateId}" missing (${localError.message}); using ${fallback}`
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
