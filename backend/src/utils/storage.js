/* =========================================================
   File storage on the cPanel account's own disk (replaces Cloudinary).

   Public files (product photos/video, avatars, store covers, banners,
   delivery proof photos) are written into the website's document root,
   PUBLIC_UPLOAD_DIR (~/vetrahq.org/uploads), and Apache serves them
   straight from PUBLIC_UPLOAD_URL (https://vetrahq.org/uploads). The
   site deploy in .cpanel.yml protects that folder from its --delete.

   Private files (KYC identity and CAC documents) are written outside
   the document root, PRIVATE_UPLOAD_DIR (~/vetra-private-uploads), so
   no URL reaches them directly. The database stores a stable API URL
   for each; signedUrl() adds an expiry and an HMAC signature, and only
   GET /api/uploads/private/... with a valid signature serves the file.

   File names are random UUIDs with an extension chosen here from the
   file's type, never the uploader's own name, so nothing executable
   can be planted and nothing collides.
   ========================================================= */

const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const PUBLIC_UPLOAD_DIR = process.env.PUBLIC_UPLOAD_DIR || path.join(os.homedir(), "vetrahq.org", "uploads");
const PUBLIC_UPLOAD_URL = (process.env.PUBLIC_UPLOAD_URL || "https://vetrahq.org/uploads").replace(/\/+$/, "");
const PRIVATE_UPLOAD_DIR = process.env.PRIVATE_UPLOAD_DIR || path.join(os.homedir(), "vetra-private-uploads");
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || "https://api.vetrahq.org").replace(/\/+$/, "");
const PRIVATE_ROUTE = "/api/uploads/private/";
// How long a signed KYC link works once handed to a vendor or admin page.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/tiff": ".tif",
  "image/bmp": ".bmp",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};
// Document types a KYC upload may keep its extension for.
const DOC_EXTS = new Set([
  ".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt", ".xls", ".xlsx", ".ods",
  ".ppt", ".pptx", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif",
  ".tif", ".tiff", ".bmp", ".zip",
]);

const CONTENT_TYPE_BY_EXT = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".heic": "image/heic", ".heif": "image/heif", ".tif": "image/tiff",
  ".tiff": "image/tiff", ".bmp": "image/bmp", ".txt": "text/plain; charset=utf-8",
  ".rtf": "application/rtf", ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text", ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet", ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

function extensionFor({ mimetype, originalname }, isPrivate) {
  const byMime = EXT_BY_MIME[String(mimetype || "").toLowerCase()];
  if (byMime) return byMime;
  if (isPrivate) {
    const ext = path.extname(String(originalname || "")).toLowerCase();
    if (DOC_EXTS.has(ext)) return ext;
  }
  return ".bin";
}

// Apache rules for the public folder: no directory listings, and nothing
// in it is ever run as a script, whatever its name.
const PUBLIC_HTACCESS = `Options -Indexes
<FilesMatch "\\.(php\\d?|phtml|phar|pl|py|cgi|sh|html?|svg|js)$">
  Require all denied
</FilesMatch>
`;

async function ensureDir(dir, isPublic) {
  await fs.mkdir(dir, { recursive: true, mode: isPublic ? 0o755 : 0o700 });
}

async function ensurePublicRoot() {
  await ensureDir(PUBLIC_UPLOAD_DIR, true);
  const htaccess = path.join(PUBLIC_UPLOAD_DIR, ".htaccess");
  try {
    await fs.access(htaccess);
  } catch {
    await fs.writeFile(htaccess, PUBLIC_HTACCESS, { mode: 0o644 });
  }
}

/**
 * Saves an uploaded file. `folder` is a plain name (products, avatars,
 * kyc...). Returns { url, key } where url is what gets stored in the DB.
 */
async function saveUpload(file, { folder, isPrivate }) {
  const now = new Date();
  const relDir = path.posix.join(folder, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"));
  const name = `${crypto.randomUUID()}${extensionFor(file, isPrivate)}`;
  const key = path.posix.join(relDir, name);
  const root = isPrivate ? PRIVATE_UPLOAD_DIR : PUBLIC_UPLOAD_DIR;
  if (!isPrivate) await ensurePublicRoot();
  await ensureDir(path.join(root, relDir), !isPrivate);
  // 0644 so Apache (running as another user on some hosts) can read a
  // public file; 0600 for documents only this account's Node app reads.
  await fs.writeFile(path.join(root, key), file.buffer, { mode: isPrivate ? 0o600 : 0o644 });
  const url = isPrivate ? `${API_PUBLIC_URL}${PRIVATE_ROUTE}${key}` : `${PUBLIC_UPLOAD_URL}/${key}`;
  return { url, key };
}

function signingKey() {
  const secret = process.env.UPLOAD_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET (or UPLOAD_SIGNING_SECRET) must be set to sign private file links.");
  return secret;
}

function signature(key, expires) {
  return crypto.createHmac("sha256", signingKey()).update(`${key}:${expires}`).digest("hex");
}

/** The private key ("kyc/2026/10/<uuid>.pdf") inside one of our stored private URLs, or null. */
function privateKeyFromUrl(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (`${parsed.protocol}//${parsed.host}` !== API_PUBLIC_URL || !parsed.pathname.startsWith(PRIVATE_ROUTE)) return null;
  const key = decodeURIComponent(parsed.pathname.slice(PRIVATE_ROUTE.length));
  return isSafeKey(key) ? key : null;
}

function isSafeKey(key) {
  return /^[a-z0-9_-]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i.test(key);
}

/** A stored private URL with an expiring signature added; any other URL is returned unchanged. */
function signedUrl(url, ttlSeconds = SIGNED_URL_TTL_SECONDS) {
  const key = privateKeyFromUrl(url);
  if (!key) return url;
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${API_PUBLIC_URL}${PRIVATE_ROUTE}${key}?expires=${expires}&sig=${signature(key, expires)}`;
}

/** Absolute path of a private file if (key, expires, sig) check out, else null. */
function verifyPrivateRequest(key, expires, sig) {
  if (!isSafeKey(key)) return null;
  const exp = Number(expires);
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = signature(key, exp);
  const given = String(sig || "");
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  return path.join(PRIVATE_UPLOAD_DIR, key);
}

function contentTypeFor(key) {
  return CONTENT_TYPE_BY_EXT[path.extname(key).toLowerCase()] || "application/octet-stream";
}

module.exports = {
  PUBLIC_UPLOAD_DIR,
  PUBLIC_UPLOAD_URL,
  PRIVATE_UPLOAD_DIR,
  saveUpload,
  signedUrl,
  privateKeyFromUrl,
  verifyPrivateRequest,
  contentTypeFor,
};
