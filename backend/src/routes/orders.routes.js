/* =========================================================
   /api/orders: checkout, customer order history + tracking,
   vendor order list + shipment updates. Backs customer/cart.html's
   checkout, customer/orders.html's tracking timeline, and
   vendor/orders.html's status filter tabs + Update Shipment modal.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { newId, newTrackingCode, orderRef } = require("../utils/id");
const { requireAuth, optionalAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");
const { notify } = require("../utils/notify");
const { sendEmail } = require("../utils/mailer");
const { escapeHtml } = require("../utils/escapeHtml");
const { nairaLabel, buildOrderEmailHtml } = require("../utils/orderEmail");
const { ORDER_ITEMS_SUBQUERY } = require("../utils/orderItemsSubquery");
const { alertIfLowStock } = require("../utils/lowStockAlert");
const { NIGERIAN_STATES } = require("../utils/nigerianStates");
const delivery = require("../utils/delivery");

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

// Checkout: works signed in or as a guest (optionalAuth), matching
// admin/settings.html's "Allow guest checkout" toggle, see
// platform_settings in migrations/001_init.sql.
router.post(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { vendorId, items, guest, idempotencyKey } = req.body;
    const deliveryMethod = req.body.deliveryMethod || "delivery";
    if (!vendorId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "vendorId and at least one item are required." });
    }

    const [settingsRows] = await pool.query(
      `SELECT guest_checkout_enabled, maintenance_mode FROM platform_settings WHERE id = 1`
    );
    // "Maintenance mode" blocks checkout for everyone, signed in or not,
    // see the /signup route's own comment on the same setting.
    if (settingsRows[0]?.maintenance_mode) {
      return res.status(503).json({ error: "VETRA is undergoing maintenance right now, please try checking out again shortly." });
    }
    if (!req.user && !settingsRows[0]?.guest_checkout_enabled) {
      return res.status(403).json({ error: "Guest checkout is currently disabled. Please sign in to complete your order." });
    }
    if (!req.user && (!guest || !guest.name || !guest.email || !guest.phone)) {
      return res.status(400).json({ error: "Guest checkout requires name, email, and phone." });
    }
    if (!["delivery", "pickup"].includes(deliveryMethod)) {
      return res.status(400).json({ error: "deliveryMethod must be 'delivery' or 'pickup'." });
    }

    // Where it's going. A signed-in buyer's saved address/state/phone
    // fill in anything the request leaves out, so a cart page that
    // predates the delivery form still checks out correctly.
    let buyerProfile = null;
    if (req.user) {
      const [[row]] = await pool.query(`SELECT name, email, phone, address, state FROM users WHERE id = ?`, [req.user.id]);
      buyerProfile = row || null;
    }
    const deliveryAddress = String(req.body.deliveryAddress || buyerProfile?.address || "").trim().slice(0, 255) || null;
    const deliveryState = req.body.deliveryState || buyerProfile?.state || null;
    const deliveryPhone = String(req.body.deliveryPhone || buyerProfile?.phone || guest?.phone || "").trim().slice(0, 40) || null;
    const deliveryNotes = String(req.body.deliveryNotes || "").trim().slice(0, 255) || null;
    if (deliveryMethod === "delivery") {
      if (!deliveryAddress) return res.status(400).json({ error: "Enter a delivery address." });
      if (!NIGERIAN_STATES.includes(deliveryState)) return res.status(400).json({ error: "Choose the state you're delivering to." });
      if (!deliveryPhone) return res.status(400).json({ error: "Enter a phone number the rider can reach you on." });
    }

    const productIds = items.map((item) => item?.productId);
    if (productIds.some((id) => !id) || new Set(productIds).size !== productIds.length) {
      return res.status(400).json({ error: "Each product may appear only once in an order." });
    }
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
        return res.status(400).json({ error: "Each item quantity must be a whole number between 1 and 1000." });
      }
    }

    // Idempotency: a retry after a stalled response (the first request
    // actually succeeded server-side; the client just never saw the
    // reply) replays that same order instead of creating a duplicate —
    // see customer/assets/cart.js for how the key is generated.
    if (idempotencyKey) {
      const [existing] = await pool.query(
        `SELECT id, tracking_code, total, delivery_fee, status FROM orders WHERE idempotency_key = ? LIMIT 1`,
        [idempotencyKey]
      );
      if (existing[0]) return res.status(200).json(existing[0]);
    }

    const [products] = await pool.query(
      `SELECT p.id, p.name, p.price, p.stock_quantity
       FROM products p JOIN users v ON v.id = p.vendor_id
       WHERE p.id IN (?) AND p.vendor_id = ? AND p.status = 'active' AND v.status = 'active'`,
      [productIds, vendorId]
    );
    if (products.length !== productIds.length) {
      return res.status(400).json({ error: "One or more items are no longer available." });
    }

    const priceById = Object.fromEntries(products.map((p) => [p.id, p.price]));
    const nameById = Object.fromEntries(products.map((p) => [p.id, p.name]));
    const stockById = Object.fromEntries(products.map((p) => [p.id, p.stock_quantity]));
    for (const item of items) {
      if (item.quantity > stockById[item.productId]) {
        return res.status(400).json({ error: `Not enough stock for one of the items in your order.` });
      }
    }

    const total = items.reduce((sum, i) => sum + priceById[i.productId] * i.quantity, 0);
    const orderId = newId();
    const trackingCode = newTrackingCode();
    const deliveryCode = delivery.newDeliveryCode();

    // The fee is recomputed here from the rate table, never taken from
    // the client, same as `total`.
    let quote = null;
    if (deliveryMethod === "delivery") {
      quote = await delivery.quoteDelivery({ vendorId, state: deliveryState, subtotal: total });
      if (!quote.deliverable) {
        return res.status(400).json({ error: `VETRA doesn't deliver to ${deliveryState} yet. Choose pickup instead.` });
      }
    }
    const deliveryFee = quote ? quote.fee : 0;
    const [[vendorPickup]] = await pool.query(`SELECT address, state, phone FROM users WHERE id = ?`, [vendorId]);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `INSERT INTO orders (id, tracking_code, buyer_id, guest_name, guest_email, guest_phone, vendor_id, delivery_method,
                             delivery_address, delivery_state, delivery_phone, delivery_notes, delivery_code, total, delivery_fee, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          trackingCode,
          req.user ? req.user.id : null,
          req.user ? null : guest.name,
          req.user ? null : guest.email,
          req.user ? null : guest.phone,
          vendorId,
          deliveryMethod,
          deliveryMethod === "delivery" ? deliveryAddress : null,
          deliveryMethod === "delivery" ? deliveryState : null,
          deliveryPhone,
          deliveryNotes,
          deliveryCode,
          total,
          deliveryFee,
          idempotencyKey || null,
        ]
      );

      for (const item of items) {
        await connection.query(
          `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase)
           VALUES (?, ?, ?, ?, ?)`,
          [newId(), orderId, item.productId, item.quantity, priceById[item.productId]]
        );
        const [stockUpdate] = await connection.query(
          `UPDATE products
           SET stock_quantity = stock_quantity - ?,
               status = IF(stock_quantity - ? <= 0, 'out_of_stock', status)
           WHERE id = ? AND status = 'active' AND stock_quantity >= ?`,
          [item.quantity, item.quantity, item.productId, item.quantity]
        );
        if (stockUpdate.affectedRows !== 1) {
          throw Object.assign(new Error("One or more items are no longer available in the requested quantity."), { status: 400 });
        }
      }

      if (deliveryMethod === "delivery") {
        await delivery.createDeliveryForOrder(connection, {
          orderId,
          vendor: vendorPickup || {},
          dropoffAddress: deliveryAddress,
          dropoffState: deliveryState,
          dropoffPhone: deliveryPhone,
          recipientName: buyerProfile?.name || guest?.name || null,
          quote,
        });
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
          `SELECT id, tracking_code, total, delivery_fee, status FROM orders WHERE idempotency_key = ? LIMIT 1`,
          [idempotencyKey]
        );
        if (existing[0]) return res.status(200).json(existing[0]);
      }
      throw err;
    } finally {
      connection.release();
    }

    const [lowStockProducts] = await pool.query(
      `SELECT p.id, p.name, p.stock_quantity, u.id AS vendor_id, u.email AS vendor_email
       FROM products p JOIN users u ON u.id = p.vendor_id
       WHERE p.id IN (?) AND p.vendor_id = ?`,
      [productIds, vendorId]
    );
    for (const product of lowStockProducts) {
      await alertIfLowStock({
        vendorId: product.vendor_id,
        vendorEmail: product.vendor_email,
        productId: product.id,
        productName: product.name,
        currentStock: product.stock_quantity,
        source: "checkout",
      });
    }

    const ref = trackingCode;
    await logActivity({
      type: "order",
      message: `Order <strong>${ref}</strong> placed${req.user ? "" : " (guest checkout)"}.`,
      actorUserId: req.user ? req.user.id : null,
      targetType: "vendor",
      targetId: vendorId,
    });
    await notify({
      userId: vendorId,
      type: "order",
      title: "New order received",
      message: `Order ${ref}, ₦${(total / 100).toLocaleString("en-NG")} across ${items.length} item${items.length > 1 ? "s" : ""}.`,
      link: "orders.html",
    });

    // New-order emails — one to the vendor, one to whoever placed the
    // order (a signed-in buyer's account email, or the guest email they
    // typed at checkout). Both best-effort: sendEmail() never throws,
    // so a delivery failure here can't turn a successful order into a
    // 500 for the buyer.
    const [[vendorRow]] = await pool.query(`SELECT name, email, store_name FROM users WHERE id = ?`, [vendorId]);
    // req.user only ever carries {id, role, adminRole} (see
    // utils/jwt.js's signToken) — a signed-in buyer's name/email needs
    // a real lookup, same reasoning as reports.routes.js's POST / for
    // reporterName.
    const buyerName = req.user ? buyerProfile?.name : guest?.name;
    const buyerEmail = req.user ? buyerProfile?.email : guest?.email;
    const totalLabel = nairaLabel(total);
    // Same item shape buildOrderEmailHtml() expects everywhere else
    // (see ORDER_ITEMS_SUBQUERY) — built here from what checkout
    // already has in memory rather than a fresh query.
    const emailItems = items.map((i) => ({
      name: nameById[i.productId],
      quantity: i.quantity || 1,
      priceAtPurchase: priceById[i.productId],
    }));

    if (vendorRow) {
      await sendEmail({
        to: vendorRow.email,
        subject: `New order ${ref}`,
        html: buildOrderEmailHtml({
          greetingName: vendorRow.name,
          introHtml: `You've got a new order, <strong>${ref}</strong>, ${totalLabel} across ${items.length} item${items.length > 1 ? "s" : ""}. Review and update it from your Orders page.`,
          ref, trackingCode, vendorStoreName: vendorRow.store_name,
          items: emailItems, deliveryMethod, deliveryAddress, total,
        }),
        logFallback: `new order notice for vendor ${vendorRow.email}: ${ref}`,
      });
    }
    if (buyerEmail) {
      await sendEmail({
        to: buyerEmail,
        subject: `Your VETRA order ${ref} is confirmed`,
        html: buildOrderEmailHtml({
          greetingName: buyerName || "there",
          introHtml: deliveryMethod === "pickup"
            ? `Thanks for your order. We'll email you once the vendor has it ready, then collect it from their store and give them your pickup code.`
            : `Thanks for your order. We'll email you as it moves toward delivery, and you can follow it live from your Orders page.`,
          ref, trackingCode, vendorStoreName: vendorRow?.store_name,
          items: emailItems, deliveryMethod, deliveryAddress, total, deliveryFee, deliveryCode,
        }),
        logFallback: `order confirmation for ${buyerEmail}: ${ref} (tracking ${trackingCode})`,
      });
    }

    res.status(201).json({ id: orderId, trackingCode, total, deliveryFee, status: "pending" });
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
      `SELECT o.*, u.store_name AS vendor_name,
          COALESCE(vk.status = 'verified', 0) AS vendor_kyc_verified,
          d.status AS delivery_status, d.mode AS delivery_mode,
          ${ORDER_ITEMS_SUBQUERY} AS items
       FROM orders o JOIN users u ON u.id = o.vendor_id
       LEFT JOIN vendor_kyc vk ON vk.vendor_id = u.id
       LEFT JOIN deliveries d ON d.order_id = o.id
       WHERE o.buyer_id = ? ORDER BY o.created_at DESC LIMIT 200`,
      [req.user.id]
    );
    // The buyer's own delivery code stays on the row (it's theirs to
    // show the rider), but only while the order is still in motion.
    res.json(orders.map((o) => (["completed", "cancelled"].includes(o.status) ? { ...o, delivery_code: null } : o)));
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
    if (status === "cancelled") {
      await pool.query(`UPDATE orders SET escrow_status = 'refunded' WHERE id = ? AND escrow_status = 'held'`, [req.params.id]);
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
// auto-cancels.
//
// On "refund": this app has no real payment gateway yet (checkout
// never actually charges a card — see backend/README.md's stubbed-
// things list), so there is no real transaction to reverse. Removing
// an item just means the buyer is never charged for it — `total`
// drops before any real charge would ever happen. escrow_status is
// only flipped to 'refunded' in the whole-order-cancels case, as a
// status label for a future real payment integration to react to.
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
    } else {
      await pool.query(`UPDATE orders SET total = ? WHERE id = ?`, [newTotal, req.params.id]);
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
