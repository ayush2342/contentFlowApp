import { Router } from 'express';
import { getDocumentFromS3, getMediaStreamFromS3 } from '../services/s3Service.js';
import { resolveTemplateId } from '../services/templateResolver.js';
import { generatePdf } from '../services/pdfService.js';
import { createOutputSession, getOutputSession } from '../services/outputSessionService.js';
import { resolveStylesheet } from '../services/stylesheetService.js';
import { env } from '../config/env.js';

const router = Router();

const requireField = (value, fieldName) => {
  if (!value) {
    const error = new Error(`Missing required field: ${fieldName}`);
    error.statusCode = 400;
    throw error;
  }
};

const buildOutputUrlPayload = async ({
  userId,
  tenantId,
  documentId,
  outputType,
  templateId,
  clientName,
}) => {
  const document = await getDocumentFromS3(tenantId, documentId);
  const resolvedTemplate = resolveTemplateId({
    templateId: templateId?.toString(),
    clientName: clientName?.toString(),
  });

  const session = createOutputSession({
    userId: userId || null,
    tenantId,
    documentId,
    templateId: resolvedTemplate,
    clientName: clientName?.toString() || null,
  });

  // Theme comes from the output session (POST body templateId), not the URL.
  const webUrl = `${env.digitalOutputBaseUrl}/output/${session.outputId}`;
  const pdfUrl = `${env.digitalOutputBaseUrl}/output/${session.outputId}/pdf`;

  return {
    outputId: session.outputId,
    tenantId,
    documentId,
    outputType,
    templateId: resolvedTemplate,
    etag: document.etag,
    lastModified: document.lastModified,
    url: outputType === 'pdf' ? pdfUrl : webUrl,
  };
};

router.post('/output', async (req, res, next) => {
  try {
    const { userId, tenantId, documentId, outputType = 'web', templateId, clientName } = req.body ?? {};
    requireField(tenantId, 'tenantId');
    requireField(documentId, 'documentId');

    const normalizedOutputType = outputType === 'pdf' ? 'pdf' : 'web';
    const payload = await buildOutputUrlPayload({
      userId,
      tenantId,
      documentId,
      outputType: normalizedOutputType,
      templateId,
      clientName,
    });

    return res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post('/output/web', async (req, res, next) => {
  try {
    const { userId, tenantId, documentId, templateId, clientName } = req.body ?? {};
    requireField(tenantId, 'tenantId');
    requireField(documentId, 'documentId');

    const payload = await buildOutputUrlPayload({
      userId,
      tenantId,
      documentId,
      outputType: 'web',
      templateId,
      clientName,
    });

    return res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post('/output/pdf', async (req, res, next) => {
  try {
    const { userId, tenantId, documentId, templateId, clientName } = req.body ?? {};
    requireField(tenantId, 'tenantId');
    requireField(documentId, 'documentId');

    const payload = await buildOutputUrlPayload({
      userId,
      tenantId,
      documentId,
      outputType: 'pdf',
      templateId,
      clientName,
    });

    return res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get('/document/:tenantId/:documentId', async (req, res, next) => {
  try {
    const { tenantId, documentId } = req.params;
    const { templateId, clientName } = req.query;

    // TODO(phase-2): add server-side cache (Redis) keyed by tenantId:documentId:etag.
    // Phase 1 intentionally fetches latest JSON from S3 on every request.
    const document = await getDocumentFromS3(tenantId, documentId);
    const resolvedTemplate = resolveTemplateId({
      templateId: templateId?.toString(),
      clientName: clientName?.toString(),
    });

    res.json({
      tenantId,
      documentId,
      templateId: resolvedTemplate,
      // TODO(phase-2): use etag for HTTP 304 handling and cache invalidation strategy.
      etag: document.etag,
      lastModified: document.lastModified,
      data: document.data,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/output/:outputId/document', async (req, res, next) => {
  try {
    const { outputId } = req.params;
    const session = getOutputSession(outputId);

    if (!session) {
      return res.status(404).json({ message: 'Output session not found or expired.' });
    }

    const document = await getDocumentFromS3(session.tenantId, session.documentId);
    const stylesheet = await resolveStylesheet({ templateId: session.templateId });

    res.json({
      outputId,
      tenantId: session.tenantId,
      documentId: session.documentId,
      templateId: session.templateId,
      formatId: stylesheet.formatId,
      layout: stylesheet.layout,
      etag: document.etag,
      lastModified: document.lastModified,
      data: document.data,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/media', async (req, res, next) => {
  try {
    const key = req.query.key?.toString();
    const tenantId = req.query.tenantId?.toString();
    requireField(key, 'key');

    if (!key.startsWith(`${env.requestPrefix}/tenants/`)) {
      return res.status(400).json({ message: 'Invalid media key prefix.' });
    }

    if (tenantId && !key.startsWith(`${env.requestPrefix}/tenants/${tenantId}/`)) {
      return res.status(403).json({ message: 'Media key does not match tenant scope.' });
    }

    const media = await getMediaStreamFromS3(key);

    if (media.contentLength) {
      res.setHeader('Content-Length', media.contentLength);
    }
    if (media.etag) {
      res.setHeader('ETag', media.etag);
    }

    res.setHeader('Content-Type', media.contentType);
    media.body.pipe(res);
  } catch (error) {
    next(error);
  }
});

/**
 * Resolve stylesheet for a template/theme.
 * Tries S3 first (STYLESHEET_S3_KEY_TEMPLATE); on failure returns local theme1/theme2.
 */
router.get('/stylesheet', async (req, res, next) => {
  try {
    const templateId = req.query.templateId?.toString();
    const stylesheet = await resolveStylesheet({ templateId });
    return res.json({
      source: stylesheet.source,
      key: stylesheet.key,
      defaultThemeId: env.defaultThemeId,
      ...stylesheet.document,
      templateId: stylesheet.templateId,
      themeId: stylesheet.themeId,
      formatId: stylesheet.formatId,
      layoutSource: stylesheet.layoutSource,
      layout: stylesheet.layout,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/pdf/:tenantId/:documentId', async (req, res, next) => {
  try {
    const { tenantId, documentId } = req.params;
    const { templateId, clientName } = req.query;

    const document = await getDocumentFromS3(tenantId, documentId);
    const resolvedTemplate = resolveTemplateId({
      templateId: templateId?.toString(),
      clientName: clientName?.toString(),
    });

    const pdf = await generatePdf({
      tenantId,
      documentId,
      etag: document.etag,
      templateId: resolvedTemplate,
      data: document.data,
    });

    res.setHeader('Content-Type', pdf.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${pdf.fileName}"`);
    res.send(pdf.fileBuffer);
  } catch (error) {
    next(error);
  }
});

router.get('/output/:outputId/pdf', async (req, res, next) => {
  try {
    const { outputId } = req.params;
    const session = getOutputSession(outputId);

    if (!session) {
      return res.status(404).json({ message: 'Output session not found or expired.' });
    }

    const document = await getDocumentFromS3(session.tenantId, session.documentId);
    const pdf = await generatePdf({
      tenantId: session.tenantId,
      documentId: session.documentId,
      etag: document.etag,
      templateId: session.templateId,
      data: document.data,
    });

    res.setHeader('Content-Type', pdf.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${pdf.fileName}"`);
    res.send(pdf.fileBuffer);
  } catch (error) {
    next(error);
  }
});

export default router;
