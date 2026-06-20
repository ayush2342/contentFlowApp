const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const assetsDir = path.join(projectRoot, "assets");
const outputPath = path.join(projectRoot, "tree_output.json");

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";
const TENANT_ID = process.env.TENANT_ID || "";
const DOCUMENT_ID = process.env.DOCUMENT_ID || "";
const CLIENT_NAME = process.env.CLIENT_NAME || "";
const TEMPLATE_ID = process.env.TEMPLATE_ID || "";

if (!TENANT_ID || !DOCUMENT_ID) {
  console.error("Missing TENANT_ID or DOCUMENT_ID. Set them in environment.");
  process.exit(1);
}

const ensureAssetsFolder = () => {
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
};

const getFileNameFromKey = (key) => {
  const normalized = String(key || "").replace(/\\/g, "/");
  return normalized.split("/").pop();
};

const buildDocumentUrl = () => {
  const query = new URLSearchParams();
  if (CLIENT_NAME) query.set("clientName", CLIENT_NAME);
  if (TEMPLATE_ID) query.set("templateId", TEMPLATE_ID);

  return `${API_BASE_URL.replace(/\/+$/, "")}/api/document/${TENANT_ID}/${DOCUMENT_ID}${
    query.toString() ? `?${query}` : ""
  }`;
};

const buildMediaUrl = (key) => {
  const query = new URLSearchParams({
    key,
    tenantId: TENANT_ID,
  });
  return `${API_BASE_URL.replace(/\/+$/, "")}/api/media?${query.toString()}`;
};

const downloadAssetIfNeeded = async (assetKey) => {
  const fileName = getFileNameFromKey(assetKey);
  if (!fileName) return null;

  const localFilePath = path.join(assetsDir, fileName);
  if (fs.existsSync(localFilePath)) return localFilePath;

  const response = await fetch(buildMediaUrl(assetKey));
  if (!response.ok) {
    throw new Error(`Failed to download asset ${assetKey}: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(localFilePath, Buffer.from(arrayBuffer));
  return localFilePath;
};

const syncAssets = async (contentItems) => {
  const imageItems = contentItems.filter((item) => item?.type === "Image" && item?.data?.url);
  for (const imageItem of imageItems) {
    const assetKey = imageItem.data.url;
    await downloadAssetIfNeeded(assetKey);
  }
};

const run = async () => {
  ensureAssetsFolder();

  const response = await fetch(buildDocumentUrl());
  if (!response.ok) {
    throw new Error(`Failed to fetch document: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload?.data)) {
    throw new Error("Document payload is not a valid content array.");
  }

  await syncAssets(payload.data);
  fs.writeFileSync(outputPath, JSON.stringify(payload.data, null, 2), "utf8");
  console.log(
    `Downloaded ${payload.data.length} blocks to tree_output.json for tenant ${TENANT_ID}, document ${DOCUMENT_ID}`
  );
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
