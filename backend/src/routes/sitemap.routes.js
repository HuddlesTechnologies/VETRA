/* =========================================================
   VETRA API: dynamic sitemap (GET /sitemap.xml on api.vetrahq.org).
   The static sitemap.xml on vetrahq.org can't list products or stores,
   since those pages need ?id= / ?vendor= from the database. This one
   is built per request from the same visibility rules as the public
   catalog: an active product from an active vendor, an active vendor.
   robots.txt on vetrahq.org points here, which is what lets Google
   accept a sitemap on another host listing vetrahq.org URLs.
   ========================================================= */

const express = require("express");
const pool = require("../db");

const router = express.Router();
const SITE = "https://vetrahq.org";
// sitemaps.org limit for one file; past this it needs a sitemap index.
const MAX_URLS = 50000;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const day = (d) => new Date(d).toISOString().slice(0, 10);

router.get("/sitemap.xml", async (req, res, next) => {
  try {
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

    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map(([loc, mod]) => `  <url><loc>${esc(loc)}</loc><lastmod>${day(mod)}</lastmod></url>`)
        .join("\n") +
      `\n</urlset>\n`;

    res
      .type("application/xml")
      .set("Cache-Control", "public, max-age=3600")
      .send(body);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
