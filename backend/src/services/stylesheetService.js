import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const themesDir = path.resolve(__dirname, '../../../shared/themes');

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
 * Resolve stylesheet using templateId only:
 * 1) Try S3 key built from templateId (theme1, theme2, theme3, …)
 * 2) On failure, load shared/themes/{templateId}.json
 * 3) If that file is missing, fall back to DEFAULT_THEME_ID
 */
export const resolveStylesheet = async ({ templateId } = {}) => {
  const requestedTemplateId = resolveLocalThemeId(templateId);
  const s3Key = buildStylesheetS3Key({ templateId: requestedTemplateId });

  if (s3Key) {
    try {
      const fromS3 = await loadStylesheetFromS3(s3Key, requestedTemplateId);
      console.info(`[stylesheet] loaded from S3: ${s3Key}`);
      return fromS3;
    } catch (error) {
      console.warn(
        `[stylesheet] S3 fetch failed for "${s3Key}" (${error.message}); falling back to local theme for templateId=${requestedTemplateId}`
      );
    }
  }

  try {
    return await loadLocalThemeDocument(requestedTemplateId);
  } catch (localError) {
    const fallback = env.defaultThemeId || 'theme2';
    console.warn(
      `[stylesheet] local theme for "${requestedTemplateId}" missing (${localError.message}); using ${fallback}`
    );
    return loadLocalThemeDocument(fallback);
  }
};

export const toPdfTypographyConfig = (stylesheetResult) => {
  const doc = stylesheetResult?.document || {};
  const themeId =
    doc.themeId || stylesheetResult?.themeId || env.defaultThemeId || 'theme2';
  if (doc.STYLES) {
    return {
      templateId: stylesheetResult.templateId,
      themeId,
      STYLES: doc.STYLES,
    };
  }
  return {
    templateId: stylesheetResult?.templateId,
    themeId,
    STYLES: doc,
  };
};
