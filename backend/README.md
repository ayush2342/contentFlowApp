# Digital Output Backend

Express API for Word-plugin-driven document rendering.

## Start

```powershell
npm install
npm run dev
```

Server default URL: `http://localhost:4000`

## Environment

Create `backend/.env` (sample in `.env.example`):

- `PORT`
- `BASE_URL`
- `AWS_REGION`
- `S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_REQUEST_PREFIX` (defaults to `dev`)
- `PDF_CACHE_TTL_SECONDS`
- `OUTPUT_SESSION_TTL_SECONDS`
- `INDESIGN_EXE_PATH`
- `INDESIGN_SCRIPT_PATH` (optional; defaults to `../frontend/pdf-output/populate-indesign.jsx`)
- `INDESIGN_TEMPLATE_PATH` (optional; defaults to `../frontend/pdf-output/templates/projectX.indd`)
- `INDESIGN_TIMEOUT_MS`

## S3 Contract

- JSON key: `dev/tenants/{tenantId}/documents/{documentId}/output.json`
- Media key path is read from JSON and proxied via `GET /api/media?key=...`.

## Endpoints

- `POST /api/output`
  - Body accepts: `userId`, `tenantId`, `documentId`, `outputType`, `templateId`, `clientName`.
  - Fetches S3 JSON first, then returns resolved URL payload.
- `POST /api/output/web`
  - Same body except `outputType` not required, always returns digital URL.
- `POST /api/output/pdf`
  - Same body except `outputType` not required, always returns API PDF URL.
- `GET /api/output/:outputId/document`
  - Resolves in-memory output session and returns latest document payload.
- `GET /api/output/:outputId/pdf`
  - Resolves output session and returns generated PDF bytes.
- `GET /api/document/:tenantId/:documentId`
  - Fetches latest JSON from S3.
  - Returns: `templateId`, `etag`, `lastModified`, `data`.
- `GET /api/media?key=...&tenantId=...`
  - Streams media from S3 for image rendering.
- `GET /api/pdf/:tenantId/:documentId`
  - Direct PDF generation path with cache key `{tenantId}:{documentId}:{etag}`.
- `GET /api/health`
- `GET /api/health/s3`
