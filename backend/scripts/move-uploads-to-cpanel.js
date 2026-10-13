/* =========================================================
   One-time move of every file still on Cloudinary onto this server
   (utils/storage.js): downloads each Cloudinary URL the database
   points at, saves it where new uploads go, and repoints the row.
   KYC documents go to private storage, everything else public.

   Safe to run more than once: it only touches URLs on
   res.cloudinary.com, so finished rows are skipped. A file that fails
   to download is left pointing at Cloudinary and reported at the end.

   Run on the server, from the app folder:
     cd ~/vetra-api && $HOME/nodevenv/vetra-api/20/bin/node scripts/move-uploads-to-cpanel.js
   Add --dry-run to only count what would move.
   ========================================================= */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const pool = require("../src/db");
const { saveUpload } = require("../src/utils/storage");

const DRY_RUN = process.argv.includes("--dry-run");

// table, id column, url column, upload folder, private?
const COLUMNS = [
  ["users", "id", "avatar_url", "avatars", false],
  ["users", "id", "store_cover_url", "covers", false],
  ["products", "id", "video_url", "products", false],
  ["site_banners", "id", "image_url", "banners", false],
  ["deliveries", "id", "proof_photo_url", "delivery-proof", false],
  ["vendor_kyc", "vendor_id", "id_document_url", "kyc", true],
  ["vendor_kyc", "vendor_id", "cac_document_url", "kyc", true],
];

const isCloudinary = (url) => typeof url === "string" && /^https:\/\/res\.cloudinary\.com\//.test(url);
const failures = [];
let moved = 0;

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimetype = (res.headers.get("content-type") || "").split(";")[0].trim();
  return { buffer, mimetype, originalname: path.basename(new URL(url).pathname) };
}

async function moveOne(url, folder, isPrivate) {
  if (DRY_RUN) {
    moved += 1;
    return url;
  }
  try {
    const file = await download(url);
    const saved = await saveUpload(file, { folder, isPrivate });
    moved += 1;
    return saved.url;
  } catch (err) {
    failures.push(`${url}: ${err.message}`);
    return url;
  }
}

async function main() {
  for (const [table, idCol, col, folder, isPrivate] of COLUMNS) {
    const [rows] = await pool.query(
      `SELECT ${idCol} AS id, ${col} AS url FROM ${table} WHERE ${col} LIKE 'https://res.cloudinary.com/%'`
    );
    console.log(`${table}.${col}: ${rows.length} file(s)`);
    for (const row of rows) {
      const next = await moveOne(row.url, folder, isPrivate);
      if (!DRY_RUN && next !== row.url) {
        await pool.query(`UPDATE ${table} SET ${col} = ? WHERE ${idCol} = ?`, [next, row.id]);
      }
    }
  }

  // products.images is a JSON array of URLs.
  const [products] = await pool.query(`SELECT id, images FROM products WHERE images LIKE '%res.cloudinary.com%'`);
  console.log(`products.images: ${products.length} product(s)`);
  for (const product of products) {
    const images = typeof product.images === "string" ? JSON.parse(product.images) : product.images;
    if (!Array.isArray(images)) continue;
    const next = [];
    for (const url of images) next.push(isCloudinary(url) ? await moveOne(url, "products", false) : url);
    if (!DRY_RUN) await pool.query(`UPDATE products SET images = ? WHERE id = ?`, [JSON.stringify(next), product.id]);
  }

  console.log(`${DRY_RUN ? "Would move" : "Moved"} ${moved} file(s).`);
  if (failures.length) {
    console.log(`${failures.length} couldn't be downloaded and still point at Cloudinary:`);
    failures.forEach((f) => console.log(`  ${f}`));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Move failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
