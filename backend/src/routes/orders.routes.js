/* =========================================================
   /api/orders — checkout, customer order history + tracking,
   vendor order list + shipment updates. Backs customer/cart.html's
   checkout, customer/orders.html's tracking timeline, and
   vendor/orders.html's status filter tabs + Update Shipment modal.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { newId } = require("../utils/id");
const { requireAuth, optionalAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");
const { notify } = require("../utils/notify");
const { ORDER_ITEMS_SUBQUERY } = require("../utils/orderItemsSubquery");

const router = express.Router();

// Column set an order moves through — see migrations/001_init.sql's
// `orders.status` enum. Kept here so the shipment-update route can
// validate against the same list the DB enforces.
const STATUSES = ["pending", "processing", "shipped", "out_for_delivery", "completed", "cancelled"];
const STATUS_TIMESTAMP_COLUMN = {
  shipped: "shipped_at",
  out_for_delivery: "out_for_delivery_at",
  completed: "delivered_at",
  cancelled: "cancelled_at",
};
// Matches api-client.js's ORDER_STATUS_LABEL — kept as a separate copy
// server-side rather than a shared import, same reasoning as
// nigerianStates.js's frontend duplicate: static reference data, not
// worth a cross-runtime shared module for four strings.
const STATUS_NOTIFY_LABEL = {
  processing: "processing",
  shipped: "shipped",
  out_for_delivery: "out for delivery",
  completed: "delivered",
  cancelled: "cancelled",
};

// Checkout — works signed in or as a guest (optionalAuth), matching
// admin/settings.html's "Allow guest checkout" toggle. Enforcing that
// toggle's actual on/off effect is a small addition once that setting
// itself is wired up (see BACKEND_GUIDE.md §4 point 4) — this route
// always allows a guest today, same as the current front-end mock.
router.post(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { vendorId, items, deliveryMethod, deliveryAddress, guest, idempotencyKey } = req.body;
    if (!vendorId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "vendorId and at least one item are required." });
    }
    if (!req.user && (!guest || !guest.name || !guest.email || !guest.phone)) {
      return res.status(400).json({ error: "Guest checkout requires name, email, and phone." });
    }

    // Idempotency: a retry after a stalled response (the first request
    // actually succeeded server-side; the client just never saw the
    // reply) replays that same order instead of creating a duplicate —
    // see customer/assets/cart.js for how the key is generated.
    if (idempotencyKey) {
      const [existing] = await pool.query(
        `SELECT id, total, status FROM orders WHERE idempotency_key = ? LIMIT 1`,
        [idempotencyKey]
      );
      if (existing[0]) return res.status(200).json(existing[0]);
    }

    const productIds = items.map((i) => i.productId);
    const [products] = await pool.query(
      `SELECT id, price, stock_quantity FROM products WHERE id IN (?) AND status = 'active'`,
      [productIds]
    );
    if (products.length !== productIds.length) {
      return res.status(400).json({ error: "One or more items are no longer available." });
    }

    const priceById = Object.fromEntries(products.map((p) => [p.id, p.price]));
    const stockById = Object.fromEntries(products.map((p) => [p.id, p.stock_quantity]));
    for (const item of items) {
      if ((item.quantity || 1) > stockById[item.productId]) {
        return res.status(400).json({ error: `Not enough stock for one of the items in your order.` });
      }
    }

    const total = items.reduce((sum, i) => sum + priceById[i.productId] * (i.quantity || 1), 0);
    const orderId = newId();

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `INSERT INTO orders (id, buyer_id, guest_name, guest_email, guest_phone, vendor_id, delivery_method, delivery_address, total, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          req.user ? req.user.id : null,
          req.user ? null : guest.name,
          req.user ? null : guest.email,
          req.user ? null : guest.phone,
          vendorId,
          deliveryMethod || "delivery",
          deliveryAddress || null,
          total,
          idempotencyKey || null,
        ]
      );

      for (const item of items) {
        await connection.query(
          `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase)
           VALUES (?, ?, ?, ?, ?)`,
          [newId(), orderId, item.productId, item.quantity || 1, priceById[item.productId]]
        );
        await connection.query(
          `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?`,
          [item.quantity || 1, item.productId]
        );
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      // Two near-simultaneous requests with the same idempotency key both
      // passed the check above before either inserted — the UNIQUE
      // constraint caught it instead. Return the winner's order rather
      // than a 500, same as the up-front check would have if it had run
      // a moment later.
      if (err.code === "ER_DUP_ENTRY" && idempotencyKey) {
        const [existing] = await pool.query(
          `SELECT id, total, status FROM orders WHERE idempotency_key = ? LIMIT 1`,
          [idempotencyKey]
        );
        if (existing[0]) return res.status(200).json(existing[0]);
      }
      throw err;
    } finally {
      connection.release();
    }

    await logActivity({
      type: "order",
      message: `Order <strong>#${orderId.slice(0, 8)}</strong> placed${req.user ? "" : " (guest checkout)"}.`,
      actorUserId: req.user ? req.user.id : null,
      targetType: "vendor",
      targetId: vendorId,
    });
    await notify({
      userId: vendorId,
      type: "order",
      title: "New order received",
      message: `Order #${orderId.slice(0, 8).toUpperCase()} — ₦${(total / 100).toLocaleString("en-NG")} across ${items.length} item${items.length > 1 ? "s" : ""}.`,
      link: "orders.html",
    });

    res.status(201).json({ id: orderId, total, status: "pending" });
  })
);

// Customer's own order history + tracking (customer/orders.html).
router.get(
  "/mine",
  requireAuth,
  requireRole("buyer"),
  asyncHandler(async (req, res) => {
    // LIMIT is a safety-net cap, not real pagination — see
    // products.routes.js's public list route for the full note on why.
    const [orders] = await pool.query(
      `SELECT o.*, u.store_name AS vendor_name, ${ORDER_ITEMS_SUBQUERY} AS items
       FROM orders o JOIN users u ON u.id = o.vendor_id
       WHERE o.buyer_id = ? ORDER BY o.created_at DESC LIMIT 200`,
      [req.user.id]
    );
    res.json(orders);
  })
);

// Vendor's order list (vendor/orders.html) — optional ?status= filter.
router.get(
  "/vendor",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const clauses = ["o.vendor_id = ?"];
    const params = [req.user.id];
    if (status && status !== "all") {
      clauses.push("o.status = ?");
      params.push(status);
    }
    const [orders] = await pool.query(
      `SELECT o.*, COALESCE(u.name, o.guest_name) AS buyer_name, ${ORDER_ITEMS_SUBQUERY} AS items
       FROM orders o LEFT JOIN users u ON u.id = o.buyer_id
       WHERE ${clauses.join(" AND ")} ORDER BY o.created_at DESC LIMIT 200`,
      params
    );
    res.json(orders);
  })
);

// Vendor's Update Shipment modal (vendor/assets/order-tracking.js on the
// front-end) — sets status/carrier/tracking_number and stamps the
// matching *_at column so customer/orders.html's timeline gets a real
// per-step timestamp instead of a guess.
router.patch(
  "/:id/shipment",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const { status, carrier, trackingNumber } = req.body;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
    }

    const [owned] = await pool.query(`SELECT vendor_id, buyer_id FROM orders WHERE id = ?`, [req.params.id]);
    if (!owned[0]) return res.status(404).json({ error: "Order not found." });
    if (owned[0].vendor_id !== req.user.id) {
      return res.status(403).json({ error: "This isn't your order." });
    }

    const timestampColumn = STATUS_TIMESTAMP_COLUMN[status];
    const setClause = timestampColumn
      ? `status = ?, carrier = ?, tracking_number = ?, ${timestampColumn} = NOW()`
      : `status = ?, carrier = ?, tracking_number = ?`;

    await pool.query(`UPDATE orders SET ${setClause} WHERE id = ?`, [
      status,
      carrier || null,
      trackingNumber || null,
      req.params.id,
    ]);

    // Delivery triggers escrow release — matches the hold-until-delivered
    // mechanics described on buyer-protection.html / vendor-protection.html.
    // The 48-hour auto-confirm case (no buyer action) needs a scheduled
    // job, not a request handler — see BACKEND_GUIDE.md's build-order note.
    if (status === "completed") {
      await pool.query(
        `UPDATE orders SET escrow_status = 'released', escrow_released_at = NOW() WHERE id = ?`,
        [req.params.id]
      );
    }

    await logActivity({
      type: "order",
      message: `Order <strong>#${req.params.id.slice(0, 8)}</strong> marked <strong>${status}</strong>.`,
      actorUserId: req.user.id,
      targetType: "vendor",
      targetId: req.user.id,
    });
    // Guest checkouts have no buyer_id — no account to notify.
    if (owned[0].buyer_id && STATUS_NOTIFY_LABEL[status]) {
      await notify({
        userId: owned[0].buyer_id,
        type: "order",
        title: `Order ${STATUS_NOTIFY_LABEL[status]}`,
        message: `Your order #${req.params.id.slice(0, 8).toUpperCase()} is now ${STATUS_NOTIFY_LABEL[status]}.`,
        link: "orders.html",
      });
    }

    res.json({ ok: true });
  })
);

module.exports = router;
