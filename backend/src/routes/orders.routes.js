/* =========================================================
   /api/orders: customer order history + tracking, vendor order list
   + shipment updates. Backs customer/orders.html's tracking timeline
   and vendor/orders.html's status filter tabs + Update Shipment modal.
   Orders are created by utils/payments.js once Paystack confirms a
   checkout (POST /api/payments/checkout), not here.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { orderRef } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");
const { notify } = require("../utils/notify");
const { sendEmail } = require("../utils/mailer");
const { escapeHtml } = require("../utils/escapeHtml");
const { nairaLabel, buildOrderEmailHtml } = require("../utils/orderEmail");
const { ORDER_ITEMS_SUBQUERY } = require("../utils/orderItemsSubquery");
const delivery = require("../utils/delivery");
const payments = require("../utils/payments");

const router = express.Router();

// Column set an order moves through, see migrations/001_init.sql's
// `orders.status` enum. Kept here so the shipment-update route can
// validate against the same list the DB enforces.
const STATUSES = ["pending", "processing", "shipped", "out_for_delivery", "completed", "cancelled"];
const STATUS_TIMESTAMP_COLUMN = {
  shipped: "shipped_at",
  out_for_delivery: "out_for_delivery_at",
  completed: "delivered_at",
  cancelled: "cancelled_at",
};
// Matches api-client.js's ORDER_STATUS_LABEL, kept as a separate copy
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
// Which of the statuses above also gets a real email, not just the
// in-app notification, matches what was actually asked for: an
// "approved" (processing), out-for-delivery, and delivered email.
// "shipped" rides along too since it's the same trigger point as
// "out for delivery" one step later, and cancelled/pending stay
// in-app-only (a cancellation email reads better coming with a reason
// a vendor might attach later, not a bare status flip).
const EMAIL_ON_STATUS = new Set(["processing", "shipped", "out_for_delivery", "completed"]);

// Checkout moved to POST /api/payments/checkout (routes/payments.routes.js):
// orders are now created only once Paystack confirms the payment. This
// stub stays so a cached old cart page fails loudly instead of placing an
// unpaid order.
router.post("/", (req, res) => {
  res.status(410).json({ error: "Checkout has moved. Refresh the page and try again." });
});

// Customer's own order history + tracking (customer/orders.html).
router.get(
  "/mine",
  requireAuth,
  requireRole("buyer"),
  asyncHandler(async (req, res) => {
    // LIMIT is a safety-net cap, not real pagination — see
    // products.routes.js's public list route for the full note on why.
    const [orders] = await pool.query(
      `SELECT o.*, u.store_name AS vendor_name,
          COALESCE(vk.status = 'verified', 0) AS vendor_kyc_verified,
          d.status AS delivery_status, d.mode AS delivery_mode, pay.channel AS payment_channel,
          ${ORDER_ITEMS_SUBQUERY} AS items
       FROM orders o JOIN users u ON u.id = o.vendor_id
       LEFT JOIN vendor_kyc vk ON vk.vendor_id = u.id
       LEFT JOIN deliveries d ON d.order_id = o.id
       LEFT JOIN payments pay ON pay.id = o.payment_id
       WHERE o.buyer_id = ? ORDER BY o.created_at DESC LIMIT 200`,
      [req.user.id]
    );
    // The buyer's own delivery code stays on the row (it's theirs to
    // show the rider), but only while the order is still in motion.
    // VETRA's commission is between VETRA and the vendor.
    res.json(orders.map(({ commission_percent, commission_amount, ...o }) => (
      ["completed", "cancelled"].includes(o.status) ? { ...o, delivery_code: null } : o
    )));
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
    // buyer_phone/buyer_address: a signed-in buyer's own account phone
    // and this specific order's delivery address (not the buyer's saved
    // account address — delivery_address is what they actually entered
    // at checkout, already on `o.*`, and is what a vendor should ship
    // to) — powers the order-detail expand's customer info card
    // (vendor/assets/orders.js). Guest orders already carry their own
    // guest_phone on `o.*`.
    // delivery_* / rider_* come from the delivery layer (utils/delivery.js):
    // the vendor's orders page uses them to show "Mark ready for pickup",
    // the pickup code to read to the rider, and who's collecting.
    const [orders] = await pool.query(
      `SELECT o.*, COALESCE(u.name, o.guest_name) AS buyer_name,
              COALESCE(o.delivery_phone, u.phone, o.guest_phone) AS buyer_phone,
              d.status AS delivery_status, d.mode AS delivery_mode, d.pickup_code,
              d.failed_attempts AS delivery_failed_attempts, d.last_failure_reason AS delivery_failure_reason,
              r.name AS rider_name, r.phone AS rider_phone, r.rider_vehicle, r.rider_plate,
              ${ORDER_ITEMS_SUBQUERY} AS items
       FROM orders o LEFT JOIN users u ON u.id = o.buyer_id
       LEFT JOIN deliveries d ON d.order_id = o.id
       LEFT JOIN users r ON r.id = d.rider_id
       WHERE ${clauses.join(" AND ")} ORDER BY o.created_at DESC LIMIT 200`,
      params
    );
    // The buyer's delivery code is their proof of receipt. A vendor who
    // could read it could mark an order delivered without handing it over.
    res.json(orders.map(({ delivery_code, delivery_code_attempts, ...o }) => ({ ...o, has_delivery_code: !!delivery_code })));
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

    const [owned] = await pool.query(
      `SELECT o.vendor_id, o.buyer_id, o.tracking_code, o.guest_name, o.guest_email, o.status AS current_status,
              o.delivery_method, o.delivery_address, o.total, o.delivery_fee, o.delivery_code,
              u.name AS buyer_name, u.email AS buyer_email,
              v.store_name AS vendor_store_name,
              ${ORDER_ITEMS_SUBQUERY} AS items
       FROM orders o LEFT JOIN users u ON u.id = o.buyer_id
       JOIN users v ON v.id = o.vendor_id
       WHERE o.id = ?`,
      [req.params.id]
    );
    if (!owned[0]) return res.status(404).json({ error: "Order not found." });
    if (owned[0].vendor_id !== req.user.id) {
      return res.status(403).json({ error: "This isn't your order." });
    }

    // Orders placed since the delivery system went live (they carry a
    // delivery_code) can't be marked shipped/delivered by hand unless the
    // vendor is shipping with their own courier: a VETRA rider's scans
    // drive those statuses, and a pickup completes only when the buyer
    // gives the vendor their code. Older orders keep the manual flow.
    const [[deliveryRow]] = await pool.query(`SELECT id, mode, status FROM deliveries WHERE order_id = ?`, [req.params.id]);
    const managedByCode = !!owned[0].delivery_code;
    const manualStatuses = ["pending", "processing", "cancelled"];
    if (managedByCode && owned[0].delivery_method === "pickup" && !manualStatuses.includes(status)) {
      return res.status(400).json({ error: "Pickup orders complete when the buyer gives you their pickup code. Use \"Confirm pickup\" instead." });
    }
    if (deliveryRow?.mode === "vetra" && !manualStatuses.includes(status)) {
      return res.status(400).json({ error: "A VETRA rider is delivering this order, so its status updates as the rider moves. Mark it ready for pickup, or switch to shipping it yourself." });
    }
    if (status === "cancelled" && deliveryRow?.mode === "vetra") {
      // Throws a 409 if a rider already has the parcel.
      await delivery.cancelDeliveryForOrder(req.params.id, { actorUserId: req.user.id, actorRole: "vendor" });
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

    // Delivery no longer releases escrow on the spot. Per
    // buyer-protection.html it releases when the buyer confirms receipt
    // (POST /api/delivery/orders/:id/confirm) or when the auto-confirm
    // window passes (scripts/delivery-cron.js), and an open report on
    // the order holds it until an admin resolves it.
    if (status === "cancelled" && owned[0].current_status !== "cancelled") {
      await pool.query(`UPDATE orders SET escrow_status = 'refunded' WHERE id = ? AND escrow_status = 'held'`, [req.params.id]);
      await payments.refundOrder(req.params.id, "remaining", "Cancelled by the vendor.");
    }
    if (deliveryRow?.mode === "self") {
      await delivery.syncSelfShipStatus(req.params.id, status, req.user.id);
    }

    const ref = orderRef({ id: req.params.id, tracking_code: owned[0].tracking_code });
    await logActivity({
      type: "order",
      message: `Order <strong>${ref}</strong> marked <strong>${status}</strong>.`,
      actorUserId: req.user.id,
      targetType: "vendor",
      targetId: req.user.id,
    });
    // Guest checkouts have no buyer_id — no account to notify in-app,
    // but they still get the email below via guest_email.
    if (owned[0].buyer_id && STATUS_NOTIFY_LABEL[status]) {
      await notify({
        userId: owned[0].buyer_id,
        type: "order",
        title: `Order ${STATUS_NOTIFY_LABEL[status]}`,
        message: `Your order ${ref} is now ${STATUS_NOTIFY_LABEL[status]}.`,
        link: "orders.html",
      });
    }

    if (EMAIL_ON_STATUS.has(status)) {
      const recipientEmail = owned[0].buyer_email || owned[0].guest_email;
      const recipientName = owned[0].buyer_name || owned[0].guest_name || "there";
      const label = STATUS_NOTIFY_LABEL[status];
      if (recipientEmail) {
        await sendEmail({
          to: recipientEmail,
          subject: `Your VETRA order ${ref} is ${label}`,
          html: buildOrderEmailHtml({
            greetingName: recipientName,
            introHtml: status === "completed"
              ? `Your order is now <strong>${label}</strong>. If everything's right, confirm it from your Orders page. If not, report an issue before the buyer protection window closes and your payment stays in escrow while we review.`
              : `Your order is now <strong>${label}</strong>.`,
            ref, trackingCode: owned[0].tracking_code, vendorStoreName: owned[0].vendor_store_name,
            items: owned[0].items, deliveryMethod: owned[0].delivery_method, deliveryAddress: owned[0].delivery_address,
            total: owned[0].total, deliveryFee: owned[0].delivery_fee, carrier, trackingNumber,
          }),
          logFallback: `order status email for ${recipientEmail}: ${ref} -> ${label}`,
        });
      }
    }

    res.json({ ok: true });
  })
);

// Vendor marks one line item unavailable (e.g. discovered out of stock
// while packing a multi-item order) instead of the blunt "cancel the
// whole order" being the only option. Only allowed before the order
// has shipped — once a shipment is on its way, pulling an item back
// out doesn't make physical sense. Recomputes `total` to exclude the
// removed item; if that was the last fulfillable item, the whole order
// auto-cancels. The buyer is refunded for the removed item, or for
// everything (delivery included) when the whole order cancels.
router.patch(
  "/:id/items/:itemId/unavailable",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const { reason } = req.body;

    const [orderRows] = await pool.query(
      `SELECT o.vendor_id, o.buyer_id, o.status, o.tracking_code, o.guest_name, o.guest_email,
              o.delivery_method, o.delivery_address,
              u.name AS buyer_name, u.email AS buyer_email,
              v.store_name AS vendor_store_name
       FROM orders o LEFT JOIN users u ON u.id = o.buyer_id
       JOIN users v ON v.id = o.vendor_id
       WHERE o.id = ?`,
      [req.params.id]
    );
    const order = orderRows[0];
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (order.vendor_id !== req.user.id) {
      return res.status(403).json({ error: "This isn't your order." });
    }
    if (!["pending", "processing"].includes(order.status)) {
      return res.status(400).json({ error: "Can't remove an item once the order has shipped, cancel the whole order instead if it can't be fulfilled." });
    }

    const [itemRows] = await pool.query(
      `SELECT oi.id, oi.status, oi.quantity, oi.price_at_purchase, p.name AS product_name
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.id = ? AND oi.order_id = ?`,
      [req.params.itemId, req.params.id]
    );
    const item = itemRows[0];
    if (!item) return res.status(404).json({ error: "Item not found on this order." });
    if (item.status === "unavailable") {
      return res.status(400).json({ error: "This item is already marked unavailable." });
    }

    await pool.query(
      `UPDATE order_items SET status = 'unavailable', unavailable_reason = ? WHERE id = ?`,
      [reason || null, item.id]
    );

    const [[{ newTotal }]] = await pool.query(
      `SELECT COALESCE(SUM(quantity * price_at_purchase), 0) AS newTotal
       FROM order_items WHERE order_id = ? AND status = 'fulfilled'`,
      [req.params.id]
    );
    const [[{ fulfilledCount }]] = await pool.query(
      `SELECT COUNT(*) AS fulfilledCount FROM order_items WHERE order_id = ? AND status = 'fulfilled'`,
      [req.params.id]
    );
    const wholeOrderCancelled = fulfilledCount === 0;

    if (wholeOrderCancelled) {
      await pool.query(
        `UPDATE orders SET total = ?, status = 'cancelled', cancelled_at = NOW(), escrow_status = 'refunded' WHERE id = ?`,
        [newTotal, req.params.id]
      );
      // Nothing left to deliver: take it off the dispatch board too.
      await delivery.cancelDeliveryForOrder(req.params.id, { actorUserId: req.user.id, actorRole: "vendor", reason: "Every item was unavailable." });
      await payments.refundOrder(req.params.id, "remaining", "Every item was unavailable.");
    } else {
      await pool.query(`UPDATE orders SET total = ? WHERE id = ?`, [newTotal, req.params.id]);
      await payments.refundOrder(req.params.id, item.quantity * item.price_at_purchase, `"${item.product_name || "An item"}" was unavailable.`);
    }

    const ref = orderRef({ id: req.params.id, tracking_code: order.tracking_code });
    await logActivity({
      type: "order",
      message: wholeOrderCancelled
        ? `Order <strong>${ref}</strong> cancelled, every item was marked unavailable.`
        : `Marked <strong>${escapeHtml(item.product_name || "an item")}</strong> unavailable on order <strong>${ref}</strong>.`,
      actorUserId: req.user.id,
      targetType: "vendor",
      targetId: req.user.id,
    });

    if (order.buyer_id) {
      await notify({
        userId: order.buyer_id,
        type: "order",
        title: wholeOrderCancelled ? "Order cancelled" : "An item in your order is unavailable",
        message: wholeOrderCancelled
          ? `Your order ${ref} was cancelled, every item turned out to be unavailable.`
          : `"${item.product_name || "An item"}" in order ${ref} is no longer available and was removed. Updated total: ${nairaLabel(newTotal)}.`,
        link: "orders.html",
      });
    }

    const recipientEmail = order.buyer_email || order.guest_email;
    const recipientName = order.buyer_name || order.guest_name || "there";
    if (recipientEmail) {
      const [items] = await pool.query(
        `SELECT p.name, oi.quantity, oi.price_at_purchase AS priceAtPurchase, oi.status
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ?`,
        [req.params.id]
      );
      await sendEmail({
        to: recipientEmail,
        subject: wholeOrderCancelled ? `Your VETRA order ${ref} was cancelled` : `An item in your VETRA order ${ref} is unavailable`,
        html: buildOrderEmailHtml({
          greetingName: recipientName,
          introHtml: wholeOrderCancelled
            ? `Unfortunately every item in this order turned out to be unavailable, so it's been cancelled.`
            : `"${escapeHtml(item.product_name || "An item")}" in this order is no longer available and has been removed${reason ? ` (${escapeHtml(reason)})` : ""}. Here's what's left:`,
          ref, trackingCode: order.tracking_code, vendorStoreName: order.vendor_store_name,
          items, deliveryMethod: order.delivery_method, deliveryAddress: order.delivery_address,
          total: newTotal,
        }),
        logFallback: `item-unavailable email for ${recipientEmail}: ${ref} — ${item.product_name}`,
      });
    }

    res.json({ ok: true, total: newTotal, orderCancelled: wholeOrderCancelled });
  })
);

module.exports = router;
