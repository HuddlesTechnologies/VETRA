/* =========================================================
   /api/notifications — real backend for customer/notifications.html
   and vendor/notifications.html, both of which previously shipped as
   three permanently hard-coded cards. requireAuth only (no role
   check) since a notification always belongs to whoever's signed in,
   buyer or vendor alike — the WHERE clause on every query already
   scopes to req.user.id, so there's nothing role-specific to enforce.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// LIMIT is a safety-net cap, not real pagination — see
// products.routes.js's public list route for the full note on why.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  })
);

router.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ count: rows[0].count });
  })
);

router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ? AND read_at IS NULL`,
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Notification not found." });
    res.json({ ok: true });
  })
);

router.patch(
  "/read-all",
  asyncHandler(async (req, res) => {
    await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ ok: true });
  })
);

module.exports = router;
