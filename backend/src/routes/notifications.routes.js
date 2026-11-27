/* =========================================================
   /api/notifications: real backend for customer/notifications.html
   and vendor/notifications.html, both of which previously shipped as
   three permanently hard-coded cards. requireAuth only (no role
   check) since a notification always belongs to whoever's signed in,
   buyer or vendor alike, the WHERE clause on every query already
   scopes to req.user.id, so there's nothing role-specific to enforce.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const push = require("../utils/push");

const router = express.Router();
router.use(requireAuth);

// LIMIT is a safety-net cap, not real pagination, see
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

// ---------- Push notifications (utils/push.js) ----------

// The key the browser subscribes with. enabled=false while VAPID keys
// aren't set on the server, and the apps then don't offer push at all.
router.get("/push/key", (req, res) => {
  res.json({ enabled: push.isConfigured(), publicKey: push.publicKey() });
});

// Called when someone turns notifications on, and again quietly on later
// visits (the browser can rotate a subscription), so it's an upsert.
router.post(
  "/push/subscribe",
  asyncHandler(async (req, res) => {
    if (!push.isConfigured()) return res.status(503).json({ error: "Push notifications aren't set up on the server yet." });
    const subscription = push.parseSubscription(req.body && req.body.subscription);
    if (!subscription) return res.status(400).json({ error: "That isn't a valid push subscription." });
    await push.saveSubscription(req.user.id, subscription, req.get("user-agent"));
    res.json({ ok: true });
  })
);

// Turning notifications off on this device, or signing out of it.
router.post(
  "/push/unsubscribe",
  asyncHandler(async (req, res) => {
    const endpoint = req.body && req.body.endpoint;
    if (endpoint) await push.removeSubscription(req.user.id, endpoint);
    res.json({ ok: true });
  })
);

// A test notification to every device this account turned push on for.
router.post(
  "/push/test",
  asyncHandler(async (req, res) => {
    if (!push.isConfigured()) return res.status(503).json({ error: "Push notifications aren't set up on the server yet." });
    push.sendToUser(req.user.id, {
      title: "Notifications are on",
      message: "This is how VETRA updates will reach you on this device.",
      link: null,
      type: "account",
    });
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
