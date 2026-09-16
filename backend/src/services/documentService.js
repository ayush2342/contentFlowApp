import crypto from 'crypto';
import { getDocumentFromS3, normalizeDocumentData } from './s3Service.js';

/**
 * Wraps JSON supplied directly in a request body so it looks like an S3
 * document: same normalization, plus an etag/lastModified for PDF caching.
 */
export const buildInlineDocument = (data) => {
  const normalized = normalizeDocumentData(data);
  const etag = crypto.createHash('md5').update(JSON.stringify(normalized)).digest('hex');

  return {
    key: null,
    etag,
    lastModified: new Date().toISOString(),
    data: normalized,
  };
};

/**
 * Document for an output session: inline JSON when the session carries it,
 * otherwise the tenant/document object in S3.
 */
export const getSessionDocument = async (session) => {
  if (session?.document) {
    return session.document;
  }

  return getDocumentFromS3(session.tenantId, session.documentId);
};
