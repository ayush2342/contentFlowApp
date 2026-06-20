import dotenv from 'dotenv';

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
  inDesignTimeoutMs: Number(process.env.INDESIGN_TIMEOUT_MS || 300000),
};
