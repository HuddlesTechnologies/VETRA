/* =========================================================
   Converts images uploaded before WebP conversion existed.

   New uploads are stored as WebP already (src/utils/images.js). This
   finds every older JPEG/PNG/GIF/HEIC still referenced from the
   database, writes a resized WebP next to it, points the database at
   the WebP, and then deletes the original once nothing refers to it.

   Columns covered: users.avatar_url, users.store_cover_url,
   products.images (JSON array), site_banners.image_url,
   deliveries.proof_photo_url. KYC documents are private files and are
   left alone.

   Safe to run any number of times: a file that's already WebP, or
   missing from disk, is skipped. Runs on every deploy (.cpanel.yml)
   and never fails it.

   Run by hand with: node scripts/convert-images-to-webp.js [--dry-run]
   ========================================================= */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs/promises");
const pool = require("../src/db");
const { PUBLIC_UPLOAD_DIR, PUBLIC_UPLOAD_URL } = require("../src/utils/storage");
const { toWebp } = require("../src/utils/images");

const DRY_RUN = process.argv.includes("--dry-run");
const CONVERTIBLE = /\.(jpe?g|png|gif|heic|heif|tiff?|bmp|avif)$/i;

const SIMPLE_COLUMNS = [
  ["users", "avatar_url"],
  ["users", "store_cover_url"],
  ["site_banners", "image_url"],
  ["deliveries", "proof_photo_url"],
];

function keyOf(url) {
  if (typeof url !== "string" || !url.startsWith(`${PUBLIC_UPLOAD_URL}/`)) return null;
  const key = decodeURIComponent(url.slice(PUBLIC_UPLOAD_URL.length + 1));
  if (key.includes("..") || !CONVERTIBLE.test(key)) return null;
  return key;
}

const converted = new Map(); // old url -> new url (or null if it couldn't be converted)
let savedBytes = 0;

async function convertUrl(url) {
  if (converted.has(url)) return converted.get(url);
  const key = keyOf(url);
  if (!key) return null;
  const src = path.join(PUBLIC_UPLOAD_DIR, key);
  const newKey = key.replace(CONVERTIBLE, ".webp");
  const dest = path.join(PUBLIC_UPLOAD_DIR, newKey);
  const newUrl = `${PUBLIC_UPLOAD_URL}/${newKey}`;
  try {
    const input = await fs.readFile(src);
    let outSize;
    try {
      outSize = (await fs.stat(dest)).size; // converted on an earlier run
    } catch {
      const webp = await toWebp(input, key.split("/")[0]);
      outSize = webp.length;
      if (!DRY_RUN) await fs.writeFile(dest, webp, { mode: 0o644 });
    }
    savedBytes += input.length - outSize;
    converted.set(url, newUrl);
    return newUrl;
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`  skipped ${key}: ${error.message}`);
    converted.set(url, null);
    return null;
  }
}

async function main() {
  let rowsUpdated = 0;

  for (const [table, column] of SIMPLE_COLUMNS) {
    const [rows] = await pool.query(
      `SELECT id, ${column} AS url FROM ${table} WHERE ${column} LIKE ? AND ${column} NOT LIKE '%.webp'`,
      [`${PUBLIC_UPLOAD_URL}/%`]
    );
    for (const row of rows) {
      const newUrl = await convertUrl(row.url);
      if (!newUrl) continue;
      if (!DRY_RUN) await pool.query(`UPDATE ${table} SET ${column} = ? WHERE id = ? AND ${column} = ?`, [newUrl, row.id, row.url]);
      rowsUpdated++;
    }
  }

  const [products] = await pool.query(`SELECT id, images FROM products WHERE images IS NOT NULL`);
  for (const product of products) {
    let images = product.images;
    if (typeof images === "string") {
      try {
        images = JSON.parse(images);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(images)) continue;
    let changed = false;
    const next = [];
    for (const url of images) {
      const newUrl = keyOf(url) ? await convertUrl(url) : null;
      if (newUrl) changed = true;
      next.push(newUrl || url);
    }
    if (!changed) continue;
    if (!DRY_RUN) await pool.query(`UPDATE products SET images = ? WHERE id = ?`, [JSON.stringify(next), product.id]);
    rowsUpdated++;
  }

  // Delete originals that nothing in the database points at any more.
  let deleted = 0;
  if (!DRY_RUN) {
    for (const [oldUrl, newUrl] of converted) {
      if (!newUrl) continue;
      const like = `%${oldUrl.slice(PUBLIC_UPLOAD_URL.length)}%`;
      const checks = await Promise.all([
        ...SIMPLE_COLUMNS.map(([t, c]) => pool.query(`SELECT 1 FROM ${t} WHERE ${c} = ? LIMIT 1`, [oldUrl])),
        pool.query(`SELECT 1 FROM products WHERE images LIKE ? LIMIT 1`, [like]),
      ]);
      if (checks.some(([rows]) => rows.length)) continue;
      try {
        await fs.unlink(path.join(PUBLIC_UPLOAD_DIR, keyOf(oldUrl)));
        deleted++;
      } catch {
        /* already gone */
      }
    }
  }

  const ok = [...converted.values()].filter(Boolean).length;
  console.log(
    `${DRY_RUN ? "[dry run] " : ""}WebP conversion: ${ok} image${ok === 1 ? "" : "s"} converted, ` +
      `${rowsUpdated} row${rowsUpdated === 1 ? "" : "s"} updated, ${deleted} original${deleted === 1 ? "" : "s"} deleted, ` +
      `${(savedBytes / 1024 / 1024).toFixed(1)}MB saved.`
  );
}

main()
  .catch((error) => {
    console.error("WebP conversion failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
