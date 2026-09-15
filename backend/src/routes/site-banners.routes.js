/* =========================================================
   /api/site-banners — backs admin/settings.html's Site Banners card
   and the picture-only promo carousel on customer/dashboard.html /
   explore.html. Split public-read/admin-write, same shape as
   /api/vendors — see BACKEND_GUIDE.md §5.

   Write routes are Super-Admin-only: changing what the storefront
   looks like site-wide is a platform-settings action, not a
   day-to-day moderation one — see BACKEND_GUIDE.md §4 point 6's
   role matrix.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { newId } = require("../utils/id");
const { requireAuth, requireAdminRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, image_url AS imageUrl, alt_text AS alt FROM site_banners ORDER BY display_order ASC`
    );
    res.json(rows);
  })
);

router.use(requireAuth, requireAdminRole("Super Admin"));

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { imageUrl, alt } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "imageUrl is required." });

    const [[{ maxOrder }]] = await pool.query(
      `SELECT COALESCE(MAX(display_order), -1) AS maxOrder FROM site_banners`
    );
    const id = newId();
    await pool.query(
      `INSERT INTO site_banners (id, image_url, alt_text, display_order) VALUES (?, ?, ?, ?)`,
      [id, imageUrl, alt || null, maxOrder + 1]
    );
    await logActivity({ type: "account", message: "Added a site banner.", actorUserId: req.user.id });
    res.status(201).json({ id });
  })
);

router.patch(
  "/:id/order",
  asyncHandler(async (req, res) => {
    const { direction } = req.body;
    if (!["up", "down"].includes(direction)) {
      return res.status(400).json({ error: "direction must be 'up' or 'down'." });
    }

    const [rows] = await pool.query(`SELECT id, display_order FROM site_banners ORDER BY display_order ASC`);
    const index = rows.findIndex((r) => r.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Banner not found." });

    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= rows.length) {
      return res.status(400).json({ error: "Already at that end of the list." });
    }

    const a = rows[index];
    const b = rows[swapWith];
    await pool.query(`UPDATE site_banners SET display_order = ? WHERE id = ?`, [b.display_order, a.id]);
    await pool.query(`UPDATE site_banners SET display_order = ? WHERE id = ?`, [a.display_order, b.id]);
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(`DELETE FROM site_banners WHERE id = ?`, [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Banner not found." });
    await logActivity({ type: "account", message: "Removed a site banner.", actorUserId: req.user.id });
    res.json({ ok: true });
  })
);

module.exports = router;
