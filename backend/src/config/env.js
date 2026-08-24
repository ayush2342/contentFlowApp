import dotenv from 'dotenv';
import { normalizeAppearanceId } from '../../../shared/layout-formats.js';

dotenv.config();

const requiredEnv = [
  'PORT',
  'BASE_URL',
  'AWS_REGION',
  'S3_BUCKET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
];

const missing = requiredEnv.filter((name) => !process.env[name]);

if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

export const env = {
  port: Number(process.env.PORT || 4000),
  outputIdPrefix: (process.env.OUTPUT_ID_PREFIX || 'main').trim(),
  baseUrl: process.env.BASE_URL,
  digitalOutputBaseUrl: process.env.DIGITAL_OUTPUT_BASE_URL || process.env.BASE_URL,
  pdfOutputBaseUrl: process.env.PDF_OUTPUT_BASE_URL || process.env.BASE_URL,
  awsRegion: process.env.AWS_REGION,
  s3Bucket: process.env.S3_BUCKET,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  requestPrefix: process.env.S3_REQUEST_PREFIX || 'dev',
  cacheTtlSeconds: Number(process.env.PDF_CACHE_TTL_SECONDS || 900),
  outputSessionTtlSeconds: Number(process.env.OUTPUT_SESSION_TTL_SECONDS || 86400),
  inDesignExePath: process.env.INDESIGN_EXE_PATH || '',
  inDesignScriptPath: process.env.INDESIGN_SCRIPT_PATH || '',
  inDesignTemplatePath: process.env.INDESIGN_TEMPLATE_PATH || '',
  inDesignTimeoutMs: Number(process.env.INDESIGN_TIMEOUT_MS || 900000),
  /** Default local theme when S3 theme is missing/fails (numeric: 1, 2, …). */
  defaultThemeId: normalizeAppearanceId(process.env.DEFAULT_THEME_ID || '2', '2'),
  /** Default local format when S3 format is missing/fails (numeric: 1, 2, …). */
  defaultFormatId: normalizeAppearanceId(process.env.DEFAULT_FORMAT_ID || '2', '2'),
  /**
   * S3 key pattern for theme JSON.
   * Placeholders: {env} / {prefix}, {id} / {themeId} / {templateId}
   * Example: {env}/appearance/theme/{id}.json → dev/appearance/theme/2.json
   */
  themeS3KeyTemplate: (
    process.env.THEME_S3_KEY_TEMPLATE ||
    '{env}/appearance/theme/{id}.json'
  ).trim(),
  /**
   * S3 key pattern for format/layout JSON.
   * Placeholders: {env} / {prefix}, {id} / {formatId}
   * Example: {env}/appearance/format/{id}.json → dev/appearance/format/2.json
   */
  formatS3KeyTemplate: (
    process.env.FORMAT_S3_KEY_TEMPLATE ||
    '{env}/appearance/format/{id}.json'
  ).trim(),
};
