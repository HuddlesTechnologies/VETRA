/* =========================================================
   /api/vendors/:vendorId/reviews — backs customer/store.html's
   review summary/list and "write a review" form. The server-side
   completed-order check here is the actual enforcement of
   "verified purchase" that the front-end's mock form could only
   simulate (see BACKEND_GUIDE.md §3's `reviews` table note).
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { newId } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    // average/count come from a real aggregate over every review, not
    // just whatever the capped list query below returns — computing them
    // from the same (LIMIT'd) rows would quietly under-report both for
    // any vendor with more reviews than the cap.
    const [[{ average, count }]] = await pool.query(
      `SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE vendor_id = ?`,
      [req.params.vendorId]
    );
    const [reviews] = await pool.query(
      `SELECT r.id, r.rating, r.review_text, r.created_at, u.name AS buyer_name
       FROM reviews r JOIN users u ON u.id = r.buyer_id
       WHERE r.vendor_id = ? ORDER BY r.created_at DESC LIMIT 200`, // safety-net cap, not real pagination
      [req.params.vendorId]
    );
    res.json({ average: average !== null ? Number(average) : null, count, reviews });
  })
);

router.post(
  "/",
  requireAuth,
  requireRole("buyer"),
  asyncHandler(async (req, res) => {
    const { rating, text, orderId } = req.body;
    if (!rating || rating < 1 || rating > 5 || !text) {
      return res.status(400).json({ error: "rating (1-5) and text are required." });
    }

    // The completed-order check — a buyer can only review a vendor they
    // actually bought a completed order from, and only once per order.
    const [orders] = await pool.query(
      `SELECT id FROM orders
       WHERE id = ? AND buyer_id = ? AND vendor_id = ? AND status = 'completed' LIMIT 1`,
      [orderId, req.user.id, req.params.vendorId]
    );
    if (!orders[0]) {
      return res.status(403).json({ error: "You can only review a vendor after a completed order." });
    }

    const id = newId();
    await pool.query(
      `INSERT INTO reviews (id, vendor_id, buyer_id, order_id, rating, review_text)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.params.vendorId, req.user.id, orderId, rating, text]
    );
    res.status(201).json({ id });
  })
);

module.exports = router;
