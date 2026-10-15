/* =========================================================
   Moves every file the database still points at somewhere else onto
   this server (utils/storage.js), and repoints the database at it:
   - anything on Cloudinary (res.cloudinary.com)
   - Google profile photos saved by "Continue with Google"
     (*.googleusercontent.com)

   It scans every text column of every table rather than a fixed list,
   so a URL is found wherever it was stored (plain columns, JSON arrays
   like products.images, report attachments...). The same URL appearing
   twice is downloaded once. KYC documents (vendor_kyc, or anything
   Cloudinary marked authenticated/private) go to private storage,
   everything else public.

   Cloudinary refuses some files on their public URL: KYC documents
   uploaded as "authenticated", and every PDF while the account's
   "Allow delivery of PDF and ZIP files" setting is off. Those are
   fetched through Cloudinary's API instead, which needs
   CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
   in .env until the move has finished.

   Safe to run any number of times: rows already on this server are
   never touched, and a file that fails stays as it was and is reported.
   .cpanel.yml runs it on every deploy; once nothing is left it only
   runs one quick query per column.

   By hand, on the server, from the app folder:
     cd ~/vetra-api && $HOME/nodevenv/vetra-api/20/bin/node scripts/move-uploads-to-cpanel.js
   Add --dry-run to only list what would move.
   ========================================================= */

const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const pool = require("../src/db");
const { saveUpload } = require("../src/utils/storage");

const DRY_RUN = process.argv.includes("--dry-run");
const REQUEST_TIMEOUT_MS = 60000;

const EXTERNAL_HOSTS = ["res.cloudinary.com", "googleusercontent.com"];
const URL_PATTERN = /https:\/\/(?:res\.cloudinary\.com|[a-z0-9-]+\.googleusercontent\.com)\/[^\s"'<>\\)]+/gi;

const MIME_BY_FORMAT = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp",
  pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};

// Which upload folder a file belongs in, from where it was found.
function folderFor(table, column) {
  if (table === "vendor_kyc") return "kyc";
  if (column === "avatar_url") return "avatars";
  if (column === "store_cover_url") return "covers";
  if (table === "products") return "products";
  if (table === "site_banners") return "banners";
  if (table === "deliveries") return "delivery-proof";
  if (/report/.test(table)) return "reports";
  return "misc";
}

function isPrivateFile(url, table) {
  return table === "vendor_kyc" || /res\.cloudinary\.com\/[^/]+\/[a-z]+\/(authenticated|private)\//.test(url);
}

async function fetchFile(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimetype = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return { buffer, mimetype };
}

// res.cloudinary.com/<cloud>/<resource>/<type>/[s--sig--/][transformations/][v123/]<public id>[.ext]
function parseCloudinaryUrl(url) {
  const { pathname } = new URL(url);
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [, resourceType, type, ...rest] = parts;
  while (rest.length && (/^s--.+--$/.test(rest[0]) || /^v\d+$/.test(rest[0]) || rest[0].includes(",") || /^[a-z]{1,3}_[^/]+$/.test(rest[0]))) {
    rest.shift();
  }
  return { resourceType, type, publicId: rest.join("/") };
}

function cloudinaryCredentials() {
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
  return cloud && key && secret ? { cloud, key, secret } : null;
}

// Cloudinary's Admin API: looks the file up, then downloads the original
// through a signed API link, which works for authenticated files and PDFs.
async function fetchFromCloudinaryApi(url) {
  const creds = cloudinaryCredentials();
  if (!creds) throw new Error("blocked on its public URL, and CLOUDINARY_* isn't set in .env to fetch it through the API");
  const { resourceType, type, publicId } = parseCloudinaryUrl(url);
  const auth = `Basic ${Buffer.from(`${creds.key}:${creds.secret}`).toString("base64")}`;
  // The public id may or may not include the extension (raw files keep it).
  let resource = null;
  for (const candidate of [publicId, publicId.replace(/\.[a-z0-9]+$/i, "")]) {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${creds.cloud}/resources/${resourceType}/${type}/${candidate.split("/").map(encodeURIComponent).join("/")}`,
      { headers: { Authorization: auth }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (res.ok) {
      resource = await res.json();
      break;
    }
  }
  if (!resource) throw new Error("not found in the Cloudinary account (deleted?)");

  const params = { public_id: resource.public_id, timestamp: Math.floor(Date.now() / 1000), type };
  if (resource.format) params.format = resource.format;
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  const signature = crypto.createHash("sha1").update(toSign + creds.secret).digest("hex");
  const query = new URLSearchParams({ ...params, api_key: creds.key, signature });
  const file = await fetchFile(`https://api.cloudinary.com/v1_1/${creds.cloud}/${resourceType}/download?${query}`);
  return { ...file, format: resource.format };
}

async function download(url) {
  let file;
  try {
    // Google serves a 96px thumbnail by default; ask for a usable size.
    file = await fetchFile(url.includes("googleusercontent.com") ? url.replace(/=s\d+(-c)?$/, "=s400-c") : url);
  } catch (err) {
    if (!url.includes("res.cloudinary.com") || ![401, 403, 404].includes(err.httpStatus)) throw err;
    file = await fetchFromCloudinaryApi(url);
  }
  const fromName = path.extname(new URL(url).pathname).slice(1).toLowerCase();
  const format = file.format || fromName;
  // Cloudinary labels some files application/octet-stream; the format fixes that.
  const known = Object.values(MIME_BY_FORMAT).includes(file.mimetype);
  const mimetype = known ? file.mimetype : MIME_BY_FORMAT[format] || file.mimetype;
  return { buffer: file.buffer, mimetype, originalname: `file.${format || "bin"}` };
}

const movedUrls = new Map(); // old URL -> new URL, so each file moves once
const failures = new Map();

async function moveUrl(url, table, column) {
  if (movedUrls.has(url)) return movedUrls.get(url);
  if (failures.has(url)) return url;
  if (DRY_RUN) {
    movedUrls.set(url, url);
    return url;
  }
  try {
    const file = await download(url);
    const saved = await saveUpload(file, { folder: folderFor(table, column), isPrivate: isPrivateFile(url, table) });
    movedUrls.set(url, saved.url);
    return saved.url;
  } catch (err) {
    failures.set(url, `${table}.${column}: ${err.message}`);
    return url;
  }
}

async function textColumns() {
  const [rows] = await pool.query(
    `SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName
     FROM information_schema.COLUMNS c
     JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
     WHERE c.TABLE_SCHEMA = DATABASE()
       AND c.DATA_TYPE IN ('char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'json')
       AND c.TABLE_NAME <> 'schema_migrations'`
  );
  // KYC first: a document that also turns up elsewhere (a log line, say)
  // must be saved privately, and the first place a URL is seen decides.
  return rows.sort((a, b) => (b.tableName === "vendor_kyc") - (a.tableName === "vendor_kyc"));
}

async function primaryKey(table) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS col FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows.map((r) => r.col);
}

async function main() {
  let found = 0;
  for (const { tableName: table, columnName: column } of await textColumns()) {
    const where = EXTERNAL_HOSTS.map(() => `\`${column}\` LIKE ?`).join(" OR ");
    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) AS count FROM \`${table}\` WHERE ${where}`,
      EXTERNAL_HOSTS.map((h) => `%${h}%`)
    );
    if (!Number(count)) continue;
    console.log(`${table}.${column}: ${count} row(s)`);

    const key = await primaryKey(table);
    const keyCols = key.length ? key : [column];
    const [rows] = await pool.query(
      `SELECT ${keyCols.map((c) => `\`${c}\``).join(", ")}, \`${column}\` AS __value FROM \`${table}\` WHERE ${where}`,
      EXTERNAL_HOSTS.map((h) => `%${h}%`)
    );
    for (const row of rows) {
      const original = typeof row.__value === "string" ? row.__value : JSON.stringify(row.__value);
      const urls = [...new Set(original.match(URL_PATTERN) || [])];
      found += urls.length;
      let next = original;
      for (const url of urls) {
        const moved = await moveUrl(url, table, column);
        if (moved !== url) next = next.split(url).join(moved);
      }
      if (DRY_RUN || next === original) continue;
      const keyValues = key.length ? key.map((c) => row[c]) : [row.__value];
      await pool.query(
        `UPDATE \`${table}\` SET \`${column}\` = ? WHERE ${keyCols.map((c) => `\`${c}\` = ?`).join(" AND ")}`,
        [next, ...keyValues]
      );
    }
  }

  if (!found) {
    console.log("Nothing left on Cloudinary or Google: every file is on this server.");
    return;
  }
  const done = [...movedUrls.values()].length;
  console.log(`${DRY_RUN ? "Would move" : "Moved"} ${done} file(s).`);
  if (failures.size) {
    console.log(`${failures.size} couldn't be moved and still point elsewhere:`);
    for (const [url, reason] of failures) console.log(`  ${url} (${reason})`);
    process.exitCode = 1;
  }
}

if (require.main !== module) {
  module.exports = { main, download, parseCloudinaryUrl };
  return;
}

main()
  .catch((err) => {
    console.error("Move failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
