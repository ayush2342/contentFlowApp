import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { env } from '../config/env.js';
import { getMediaStreamFromS3 } from './s3Service.js';
import { resolveStylesheet, toPdfTypographyConfig } from './stylesheetService.js';

const pdfCache = new Map();
const defaultPdfSourceDir = path.resolve(process.cwd(), '..', 'frontend', 'pdf-output');
const runtimeRoot = path.resolve(process.cwd(), 'runtime', 'pdf-jobs');

const getCacheRecord = (cacheKey) => {
  const record = pdfCache.get(cacheKey);
  if (!record) return null;

  const isExpired = Date.now() - record.createdAt > env.cacheTtlSeconds * 1000;
  if (isExpired) {
    pdfCache.delete(cacheKey);
    return null;
  }
  return record;
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const collectUrlsFromBlocks = (blocks, keys) => {
  if (!Array.isArray(blocks)) return;
  for (const item of blocks) {
    const url = item?.data?.url;
    if (url && !keys.includes(url)) {
      keys.push(url);
    }
  }
};

const collectImageKeys = (data) => {
  const keys = [];
  if (!data) return keys;

  // Flat block array: [{ type, data: { url } }, ...]
  if (Array.isArray(data)) {
    collectUrlsFromBlocks(data, keys);
    return keys;
  }

  // Paged shape: { pages: [{ content: [...] }, ...] }
  if (Array.isArray(data.pages)) {
    for (const page of data.pages) {
      collectUrlsFromBlocks(page?.content, keys);
    }
  }

  return keys;
};

const resolveInDesignPaths = () => {
  const scriptSourcePath =
    env.inDesignScriptPath || path.join(defaultPdfSourceDir, 'populate-indesign.jsx');
  const templateSourcePath =
    env.inDesignTemplatePath || path.join(defaultPdfSourceDir, 'templates', 'projectX.indd');

  if (!env.inDesignExePath) {
    throw new Error(
      'INDESIGN_EXE_PATH is not configured. Set backend .env to the InDesign executable path.'
    );
  }

  return {
    scriptSourcePath,
    templateSourcePath,
  };
};

const runInDesignScript = async ({ scriptPath }) =>
  new Promise((resolve, reject) => {
    const escapedScriptPath = scriptPath.replace(/'/g, "''");

    const psCommand = [
      "$ErrorActionPreference='Stop'",
      "$app = New-Object -ComObject InDesign.Application",
      `$app.DoScript('${escapedScriptPath}', 1246973031)`, // 1246973031 = JavaScript
      "Write-Output 'INDESIGN_SCRIPT_DONE'",
    ].join('; ');

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
      { windowsHide: true }
    );

    let stderr = '';
    let stdout = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`InDesign execution timed out after ${env.inDesignTimeoutMs}ms`));
    }, env.inDesignTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`InDesign COM execution failed (code ${code}). ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

/**
 * Generates PDF using InDesign + ExtendScript for the provided JSON payload.
 * Phase 1 keeps a short-lived in-memory cache; persistent/shared cache can be added later.
 */
export const generatePdf = async ({ tenantId, documentId, etag, templateId, data }) => {
  const resolvedTemplateId = templateId || env.defaultThemeId || 'theme2';
  const cacheKey = `${tenantId}:${documentId}:${etag || 'no-etag'}:${resolvedTemplateId}`;
  const cached = getCacheRecord(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const { scriptSourcePath, templateSourcePath } = resolveInDesignPaths();
  const jobId = crypto.randomUUID();
  const jobDir = path.join(runtimeRoot, jobId);
  const assetsDir = path.join(jobDir, 'assets');
  const templatesDir = path.join(jobDir, 'templates');
  const runtimeScriptPath = path.join(jobDir, 'populate-indesign.jsx');
  const runtimeTemplatePath = path.join(templatesDir, 'projectX.indd');
  const runtimeJsonPath = path.join(jobDir, 'tree_output.json');
  const runtimePdfPath = path.join(jobDir, 'output.pdf');
  const runtimeTypographyPath = path.join(jobDir, 'typography-styles.json');

  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(templatesDir, { recursive: true });
  await fs.copyFile(scriptSourcePath, runtimeScriptPath);
  await fs.copyFile(templateSourcePath, runtimeTemplatePath);

  // Stylesheet + layout from templateId: S3 first, else local theme/format.
  try {
    const stylesheet = await resolveStylesheet({ templateId: resolvedTemplateId });
    const typographyConfig = toPdfTypographyConfig(stylesheet);
    await fs.writeFile(runtimeTypographyPath, JSON.stringify(typographyConfig, null, 2), 'utf8');
    const runtimeLayoutPath = path.join(jobDir, 'layout-format.json');
    await fs.writeFile(
      runtimeLayoutPath,
      JSON.stringify(
        {
          formatId: stylesheet.formatId,
          layout: stylesheet.layout,
        },
        null,
        2
      ),
      'utf8'
    );
    console.info(
      `[pdf] typography source=${stylesheet.source} templateId=${resolvedTemplateId} theme=${stylesheet.themeId} format=${stylesheet.formatId} layoutSource=${stylesheet.layoutSource}`
    );
  } catch (typographyError) {
    console.warn(
      `Could not resolve stylesheet into job folder: ${typographyError.message}`
    );
  }

  await fs.writeFile(runtimeJsonPath, JSON.stringify(data ?? [], null, 2), 'utf8');

  const imageKeys = collectImageKeys(data);
  for (const key of imageKeys) {
    const media = await getMediaStreamFromS3(key);
    const fileName = path.basename(key);
    const fileBuffer = await streamToBuffer(media.body);
    await fs.writeFile(path.join(assetsDir, fileName), fileBuffer);
  }

  await runInDesignScript({ scriptPath: runtimeScriptPath });

  let fileBuffer;
  try {
    fileBuffer = await fs.readFile(runtimePdfPath);
  } catch {
    throw new Error(
      `InDesign did not produce output.pdf for document ${documentId}. Check template labels/script setup.`
    );
  }

  const record = {
    fileBuffer,
    contentType: 'application/pdf',
    fileName: `${documentId}.pdf`,
    createdAt: Date.now(),
    fromCache: false,
  };
  pdfCache.set(cacheKey, record);
  return record;
};
