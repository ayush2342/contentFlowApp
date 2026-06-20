import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

const s3Client = new S3Client({
  region: env.awsRegion,
  credentials: {
    accessKeyId: env.awsAccessKeyId,
    secretAccessKey: env.awsSecretAccessKey,
  },
});

const streamToString = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
};

export const buildDocumentKey = (tenantId, documentId) =>
  `${env.requestPrefix}/tenants/${tenantId}/documents/${documentId}/output.json`;

export const getDocumentFromS3 = async (tenantId, documentId) => {
  const key = buildDocumentKey(tenantId, documentId);

  const [headResult, getResult] = await Promise.all([
    s3Client.send(
      new HeadObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
      })
    ),
    s3Client.send(
      new GetObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
      })
    ),
  ]);

  const rawText = await streamToString(getResult.Body);

  return {
    key,
    etag: headResult.ETag?.replaceAll('"', '') ?? null,
    lastModified: headResult.LastModified?.toISOString() ?? null,
    data: JSON.parse(rawText),
  };
};

export const getMediaStreamFromS3 = async (key) => {
  const result = await s3Client.send(
    new GetObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
    })
  );

  return {
    body: result.Body,
    contentType: result.ContentType || 'application/octet-stream',
    contentLength: result.ContentLength,
    etag: result.ETag?.replaceAll('"', '') ?? null,
  };
};

export const checkS3Health = async () => {
  const result = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: env.s3Bucket,
      MaxKeys: 1,
    })
  );

  return {
    bucket: env.s3Bucket,
    keyCountChecked: result.KeyCount ?? 0,
  };
};
