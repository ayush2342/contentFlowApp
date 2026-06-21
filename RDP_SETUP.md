# RDP Production Setup Guide (Windows VM)

This guide documents the exact setup that worked on RDP for this project, including common issues and fixes.

## Final Deployment Shape

- One VM, one public domain
- IIS serves `frontend/digital-output/dist` static files
- IIS proxies `/api/*` to backend on `localhost:4000`
- Backend runs with PM2
- PDF route is wired in backend, but InDesign runtime still needs validation in your environment

---

## 1) Prerequisites to Install on VM

Install:

- Node.js LTS
- Git
- AWS CLI v2
- IIS (Web Server role)
- IIS URL Rewrite module
- IIS Application Request Routing (ARR)
- Adobe Creative Cloud Desktop
- Adobe InDesign (for PDF flow)

If `winget` is unavailable on Windows Server, use MSI installers manually.

### Verify tools

```powershell
node -v
npm -v
git --version
aws --version
```

If `aws` is not recognized after install, add to system `PATH`:

`C:\Program Files\Amazon\AWSCLIV2`

---

## 2) Clone and Install Project

```powershell
mkdir C:\apps -Force
cd C:\apps
git clone https://github.com/ayush2342/contentFlowApp.git
cd contentFlowApp
```

Install backend:

```powershell
cd backend
npm install
```

Install and build digital frontend:

```powershell
cd ..\frontend\digital-output
npm install
npm run build
```

---

## 3) Backend Environment

Configure `backend/.env` with your production values.

Important production convention:

- Keep `PORT=4000` internal
- Use public domain URLs **without `:4000`** for:
  - `BASE_URL`
  - `DIGITAL_OUTPUT_BASE_URL`
  - `PDF_OUTPUT_BASE_URL`

Example:

```env
PORT=4000
BASE_URL=http://<public-dns>
DIGITAL_OUTPUT_BASE_URL=http://<public-dns>
PDF_OUTPUT_BASE_URL=http://<public-dns>

AWS_REGION=us-east-1
S3_BUCKET=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_REQUEST_PREFIX=dev

PDF_CACHE_TTL_SECONDS=900
OUTPUT_SESSION_TTL_SECONDS=86400

INDESIGN_EXE_PATH=C:\Program Files\Adobe\Adobe InDesign 2025\InDesign.exe
INDESIGN_SCRIPT_PATH=
INDESIGN_TEMPLATE_PATH=
INDESIGN_TIMEOUT_MS=300000
```

---

## 4) Start Backend with PM2

From `backend`:

```powershell
npm install -g pm2
pm2 start src/index.js --name digital-output-backend
pm2 save
pm2 status
```

Health check (local):

`http://localhost:4000/api/health`

---

## 5) IIS Setup (Static + API Proxy)

### 5.1 Enable ARR Proxy

In IIS Manager:

- Server node -> `Application Request Routing Cache`
- `Server Proxy Settings`
- Enable `Proxy`

### 5.2 Set Site Path

Point `Default Web Site` physical path to:

`...\contentFlowApp\frontend\digital-output\dist`

### 5.3 URL Rewrite Rules

Rule 1: `API_To_Backend`

- Match: `^api/(.*)`
- Action: Rewrite to `http://localhost:4000/api/{R:1}`
- Append query string: true
- Stop processing: true

Rule 2: `SPA_Fallback`

- Match: `^(.*)$`
- Conditions:
  - `{REQUEST_URI}` does not match `^/api/.*`
  - `{REQUEST_FILENAME}` is not a file
  - `{REQUEST_FILENAME}` is not a directory
- Action: Rewrite to `/index.html`
- Stop processing: true

### 5.4 Keep `web.config` Persistent

Do **not** edit only `dist/web.config` manually (it gets removed on rebuild).

Use:

`frontend/digital-output/public/web.config`

This file is copied automatically into `dist` on every build.

---

## 6) Permissions (Common Failure Point)

If IIS test shows authorization/path access issues, grant read/execute to IIS identities on site path:

```powershell
icacls "<site-dist-path>" /grant "IIS AppPool\DefaultAppPool:(OI)(CI)(RX)" /T
icacls "<site-dist-path>" /grant "IUSR:(OI)(CI)(RX)" /T
icacls "<site-dist-path>" /grant "IIS_IUSRS:(OI)(CI)(RX)" /T
```

Then:

```powershell
iisreset
```

---

## 7) Firewall + Security Group

Windows firewall inbound:

- 80 (required)
- 443 (if HTTPS)
- 4000 (optional for direct debugging)

AWS Security Group inbound:

- 80 from allowed client ranges
- 443 from allowed client ranges (if configured)
- 4000 only if needed for debugging

---

## 8) Validate End-to-End

1. `http://localhost:4000/api/health` (VM local)
2. `http://<public-dns>/api/health` (public through IIS)
3. Postman `POST /api/output/web`
4. Open returned URL `/output/{outputId}`
5. Verify content loads and route navigation works

---

## 9) API Calls for Plugin Team

### Web

`POST /api/output/web`

Body:

```json
{
  "tenantId": "<tenant-id>",
  "documentId": "<document-id>"
}
```

### PDF

`POST /api/output/pdf`

Body:

```json
{
  "tenantId": "<tenant-id>",
  "documentId": "<document-id>"
}
```

Both return a `url` for the plugin to open.

---

## 10) PDF Status (Current)

Backend PDF route is wired:

- `GET /api/output/:outputId/pdf`

Current caveat:

- Adobe InDesign installation/runtime on VM is required for real PDF generation
- This flow is configured in code but needs successful Adobe environment validation
- Update this document after InDesign is confirmed working in your VM

---

## 11) Troubleshooting Quick Reference

- **502 from IIS** -> backend unavailable or bad proxy target
- **500 from IIS** -> rewrite/authorization/path config issue
- **404 on `/api/health` via public domain** -> `web.config` missing after rebuild or API rule missing
- **`aws` / `npm` not recognized** -> install tool and fix system `PATH`
- **`Cannot GET /output/...`** -> frontend route not being served (proxy/static route issue)
- **`Failed to fetch` in browser** -> wrong `VITE_API_BASE_URL` or API route unreachable

