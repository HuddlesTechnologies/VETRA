/* =========================================================
   /api/social-links: the social media links in the public site
   footer (script.js renders them on every public page). Public read;
   writes are Super-Admin-only, same as /api/site-banners, since they
   change what the whole site shows.

   PUT replaces the whole list in one go: admin/settings.html's Social
   Media card edits, adds, removes and reorders rows locally and saves
   them together, so there's no partial state to reconcile.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { newId } = require("../utils/id");
const { requireAuth, requireAdminRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");
const { escapeHtml } = require("../utils/escapeHtml");

const router = express.Router();

const MAX_LINKS = 12;

// Only an absolute https:// link, returned in the URL parser's normalized
// form (quotes, spaces and angle brackets percent-encoded) so it can't
// break out of the href="" attribute it's rendered into.
function normalizeSocialUrl(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 500) return null;
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.includes(".")) return null;
  return parsed.href;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, label, url FROM social_links ORDER BY display_order ASC, label ASC`
    );
    res.set("Cache-Control", "public, max-age=300");
    res.json(rows);
  })
);

router.put(
  "/",
  requireAuth,
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const input = req.body && req.body.links;
    if (!Array.isArray(input)) return res.status(400).json({ error: "links must be a list." });
    if (input.length > MAX_LINKS) return res.status(400).json({ error: `You can add up to ${MAX_LINKS} social links.` });

    const links = [];
    const seen = new Set();
    for (const [i, item] of input.entries()) {
      const label = String((item && item.label) || "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (!label) return res.status(400).json({ error: `Link ${i + 1} needs a name (e.g. Instagram).` });
      const url = normalizeSocialUrl(item && item.url);
      if (!url) return res.status(400).json({ error: `${label}: enter a full https:// link to the profile.` });
      const key = label.toLowerCase();
      if (seen.has(key)) return res.status(400).json({ error: `${label} is listed twice.` });
      seen.add(key);
      links.push({ label, url });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM social_links`);
      for (const [i, link] of links.entries()) {
        await conn.query(
          `INSERT INTO social_links (id, label, url, display_order, updated_by_user_id) VALUES (?, ?, ?, ?, ?)`,
          [newId(), link.label, link.url, i, req.user.id]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logActivity({
      type: "account",
      message: links.length
        ? `Updated the site's social media links (${links.map((l) => escapeHtml(l.label)).join(", ")}).`
        : "Removed all of the site's social media links.",
      actorUserId: req.user.id,
    });
    const [rows] = await pool.query(`SELECT id, label, url FROM social_links ORDER BY display_order ASC`);
    res.json(rows);
  })
);

module.exports = router;
