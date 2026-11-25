/* =========================================================
   GET /sitemap.xml on the API: the live product and store sitemap
   (utils/sitemap.js), for checking it by hand. Search engines read the
   copy written into the website itself, https://vetrahq.org/
   sitemap-listings.xml, since Search Console only accepts a sitemap on
   the same host as the pages it lists.
   ========================================================= */

const express = require("express");
const { buildSitemapXml } = require("../utils/sitemap");

const router = express.Router();

router.get("/sitemap.xml", async (req, res, next) => {
  try {
    res
      .type("application/xml")
      .set("Cache-Control", "public, max-age=3600")
      .send(await buildSitemapXml());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
