/* =========================================================
   Sitemap of every product and store a guest can see, for search
   engines. Same visibility rules as the public catalogue: an active
   vendor's store, and an active product of an active vendor.

   Search Console only accepts a sitemap on the same host as the pages
   it lists, so the copy Google reads is a plain file in the website's
   own folder: writeSitemapFile() writes it to
   ~/vetrahq.org/sitemap-listings.xml (next to PUBLIC_UPLOAD_DIR, the
   same document root uploads go into), served at
   https://vetrahq.org/sitemap-listings.xml. The site's sitemap.xml is
   an index that points at it and at sitemap-pages.xml.

   It is rewritten on every scheduled sweep (every 10 minutes) and on
   every deploy (scripts/write-sitemap.js, run by .cpanel.yml, which
   also protects the file from the deploy's rsync --delete).
   GET /sitemap.xml on the API (routes/sitemap.routes.js) serves the
   same XML live, for checking it by hand.
   ========================================================= */

const fs = require("fs/promises");
const path = require("path");
const pool = require("../db");
const { PUBLIC_UPLOAD_DIR } = require("./storage");

const SITE = "https://vetrahq.org";
const FILE_NAME = "sitemap-listings.xml";
// sitemaps.org limit for one file; past this it needs splitting.
const MAX_URLS = 50000;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const day = (d) => new Date(d).toISOString().slice(0, 10);

async function buildSitemapXml() {
  const [vendors] = await pool.query(
    `SELECT u.id,
            COALESCE(MAX(p.updated_at), u.created_at) AS lastmod
       FROM users u
       LEFT JOIN products p ON p.vendor_id = u.id AND p.status = 'active'
      WHERE u.role = 'vendor' AND u.status = 'active'
      GROUP BY u.id, u.created_at`
  );
  const [products] = await pool.query(
    `SELECT p.id, p.updated_at AS lastmod
       FROM products p
       JOIN users v ON v.id = p.vendor_id
      WHERE p.status = 'active' AND v.status = 'active'
      ORDER BY p.updated_at DESC
      LIMIT ?`,
    [Math.max(0, MAX_URLS - vendors.length)]
  );

  const urls = [
    ...vendors.map((v) => [`${SITE}/customer/store.html?vendor=${encodeURIComponent(v.id)}`, v.lastmod]),
    ...products.map((p) => [`${SITE}/customer/product.html?id=${encodeURIComponent(p.id)}`, p.lastmod]),
  ];

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(([loc, mod]) => `  <url><loc>${esc(loc)}</loc><lastmod>${day(mod)}</lastmod></url>`)
      .join("\n") +
    `\n</urlset>\n`
  );
}

// The website's document root: the folder uploads/ lives in. Only
// written when that folder really is the website (it has index.html),
// so a local setup with PUBLIC_UPLOAD_DIR=./uploads writes nothing.
function siteRoot() {
  return process.env.SITE_DOCUMENT_ROOT || path.dirname(PUBLIC_UPLOAD_DIR);
}

async function writeSitemapFile() {
  const root = siteRoot();
  try {
    await fs.access(path.join(root, "index.html"));
  } catch {
    return { written: false, reason: `no website at ${root}` };
  }
  const xml = await buildSitemapXml();
  const target = path.join(root, FILE_NAME);
  // Write then rename, so a crawler never reads a half-written file.
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, xml, { mode: 0o644 });
  await fs.rename(tmp, target);
  return { written: true, urls: (xml.match(/<url>/g) || []).length };
}

module.exports = { buildSitemapXml, writeSitemapFile, FILE_NAME };
