/* =========================================================
   Writes https://vetrahq.org/sitemap-listings.xml (every visible
   product and store) into the website's folder once, then exits.
   Run by .cpanel.yml after every deploy so the file exists straight
   away; the scheduled sweep keeps it fresh after that
   (src/utils/sitemap.js).
   ========================================================= */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../src/db");
const { writeSitemapFile } = require("../src/utils/sitemap");

writeSitemapFile()
  .then((result) => console.log("sitemap", JSON.stringify(result)))
  .catch((err) => {
    console.error("sitemap not written:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
