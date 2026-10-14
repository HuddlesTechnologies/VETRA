/* =========================================================
   VETRA delivery service: the one place the delivery state machine,
   fee quoting, rider assignment, escrow release, and the scheduled
   sweep live. routes/delivery.routes.js and routes/orders.routes.js
   both call into this rather than writing `deliveries` rows
   themselves, so every transition goes through the same guards and
   the same notifications. The full flow is written up in
   DELIVERY_SYSTEM.md at the project root.

   Every transition is a single guarded UPDATE
   (`WHERE id = ? AND status IN (...)`) whose affectedRows is
   checked, same idea as checkout's guarded stock decrement. Two
   riders tapping "accept", or a rider and the vendor acting at the
   same moment, can't both win: the loser's UPDATE matches no row and
   gets a clean 409 instead of corrupting the state.
   ========================================================= */

const { randomInt } = require("crypto");
const pool = require("../db");
const { newId, orderRef } = require("./id");

// Order ID for messages, from a delivery context row (which carries both
// the delivery's own id and the order's tracking_code).
const refOf = (ctx) => orderRef({ id: ctx.order_id, tracking_code: ctx.tracking_code });
const { notify } = require("./notify");
const { sendEmail } = require("./mailer");
const { logActivity } = require("./activityLog");
const { escapeHtml } = require("./escapeHtml");
const { NIGERIAN_STATES } = require("./nigerianStates");
const { nairaLabel, refundDestination, buildOrderEmailHtml } = require("./orderEmail");
const { ORDER_ITEMS_SUBQUERY } = require("./orderItemsSubquery");

const FRONTEND_URL = process.env.FRONTEND_URL || "https://vetrahq.org";

// A rider offered a job has this long to accept before the sweep hands
// it to someone else.
const ASSIGNMENT_TIMEOUT_MINUTES = 20;
// Auto-assign never stacks more than this many live jobs on one rider.
const MAX_ACTIVE_JOBS_PER_RIDER = 5;
// Wrong buyer-code guesses before the order locks and needs an admin.
const MAX_DELIVERY_CODE_ATTEMPTS = 5;

// Statuses where a rider is physically or about-to-be involved.
const RIDER_ACTIVE_STATUSES = ["assigned", "accepted", "picked_up", "out_for_delivery", "returning"];
// Statuses from which the delivery can still be cancelled or switched
// to vendor self-shipping: the parcel hasn't left the vendor yet.
const PRE_PICKUP_STATUSES = ["awaiting_vendor", "ready", "assigned", "accepted"];

const STATUS_TIMESTAMP_COLUMN = {
  ready: "ready_at",
  assigned: "assigned_at",
  accepted: "accepted_at",
  picked_up: "picked_up_at",
  out_for_delivery: "out_for_delivery_at",
  delivered: "delivered_at",
  returned: "returned_at",
  cancelled: "cancelled_at",
};

const FAILURE_REASONS = {
  unreachable: "Recipient unreachable",
  not_home: "Nobody available to receive",
  wrong_address: "Address incorrect or not found",
  refused: "Recipient refused the package",
  other: "Other",
};

class DeliveryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function newDeliveryCode() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

function newPickupCode() {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

// ---------- Settings & quoting ----------

async function getDeliverySettings(db = pool) {
  const [[row]] = await db.query(
    `SELECT free_delivery_threshold, rider_payout_percent, auto_assign_riders, auto_confirm_hours, max_delivery_attempts
     FROM platform_settings WHERE id = 1`
  );
  return {
    freeDeliveryThreshold: Number(row?.free_delivery_threshold || 0),
    riderPayoutPercent: Number(row?.rider_payout_percent ?? 80),
    autoAssignRiders: row ? !!row.auto_assign_riders : true,
    autoConfirmHours: Number(row?.auto_confirm_hours || 48),
    maxDeliveryAttempts: Number(row?.max_delivery_attempts || 3),
  };
}

/**
 * Server-side delivery price for one vendor's order to one state. This
 * is the only place a fee is computed: the cart page calls it through
 * GET /api/delivery/quote to display a number, and checkout calls it
 * again itself rather than trusting whatever the client showed.
 */
async function quoteDelivery({ vendorId, state, subtotal = 0 }, db = pool) {
  if (!NIGERIAN_STATES.includes(state)) {
    throw new DeliveryError("Choose a valid delivery state.");
  }
  const [[vendor]] = await db.query(
    `SELECT id, state, address, phone, store_name FROM users WHERE id = ? AND role = 'vendor' AND status = 'active'`,
    [vendorId]
  );
  if (!vendor) throw new DeliveryError("This store isn't available right now.", 404);

  const [[rate]] = await db.query(`SELECT * FROM delivery_rates WHERE state = ?`, [state]);
  const settings = await getDeliverySettings(db);
  if (!rate || !rate.active) {
    return { deliverable: false, state, fee: 0, baseFee: 0, riderPayout: 0, pickupState: vendor.state };
  }

  const intraState = !!vendor.state && vendor.state === state;
  const baseFee = intraState ? rate.intra_state_fee : rate.inter_state_fee;
  const freeDelivery = settings.freeDeliveryThreshold > 0 && subtotal >= settings.freeDeliveryThreshold;
  return {
    deliverable: true,
    state,
    intraState,
    baseFee,
    fee: freeDelivery ? 0 : baseFee,
    freeDelivery,
    freeDeliveryThreshold: settings.freeDeliveryThreshold,
    riderPayout: Math.round((baseFee * settings.riderPayoutPercent) / 100),
    // Same-state parcels skip the line-haul leg, so they're quoted
    // faster than the rate table's inter-state window.
    etaDaysMin: intraState ? 1 : rate.eta_days_min,
    etaDaysMax: intraState ? 2 : rate.eta_days_max,
    pickupState: vendor.state,
  };
}

// ---------- Creation & events ----------

async function recordEvent(db, { deliveryId, event, note = null, publicNote = null, actorUserId = null, actorRole = null }) {
  await db.query(
    `INSERT INTO delivery_events (id, delivery_id, event, note, public_note, actor_user_id, actor_role)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId(), deliveryId, event, note, publicNote, actorUserId, actorRole]
  );
}

/** Called inside checkout's transaction, so the order and its delivery commit together. */
async function createDeliveryForOrder(conn, { orderId, vendor, dropoffAddress, dropoffState, dropoffPhone, recipientName, quote }) {
  const deliveryId = newId();
  await conn.query(
    `INSERT INTO deliveries
       (id, order_id, pickup_code, pickup_address, pickup_state, pickup_phone,
        dropoff_address, dropoff_state, dropoff_phone, recipient_name, fee_charged, rider_payout)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      deliveryId, orderId, newPickupCode(), vendor.address || null, vendor.state || null, vendor.phone || null,
      dropoffAddress, dropoffState, dropoffPhone, recipientName, quote.fee, quote.riderPayout,
    ]
  );
  await recordEvent(conn, {
    deliveryId,
    event: "created",
    note: "Order placed, waiting for the vendor to pack it.",
    publicNote: "Order placed",
  });
  return deliveryId;
}

// ---------- Context loading & announcements ----------

async function loadDeliveryContext(deliveryId, db = pool) {
  const [rows] = await db.query(
    `SELECT d.*, o.tracking_code, o.buyer_id, o.vendor_id, o.total, o.delivery_fee, o.delivery_code,
            o.delivery_method, o.delivery_address, o.guest_name, o.guest_email, o.status AS order_status,
            b.name AS buyer_name, b.email AS buyer_email,
            v.name AS vendor_name, v.email AS vendor_email, v.store_name AS vendor_store_name,
            r.name AS rider_name, r.email AS rider_email, r.phone AS rider_phone,
            r.rider_vehicle, r.rider_plate, pay.channel AS payment_channel,
            ${ORDER_ITEMS_SUBQUERY} AS items
     FROM deliveries d
     JOIN orders o ON o.id = d.order_id
     LEFT JOIN payments pay ON pay.id = o.payment_id
     LEFT JOIN users b ON b.id = o.buyer_id
     JOIN users v ON v.id = o.vendor_id
     LEFT JOIN users r ON r.id = d.rider_id
     WHERE d.id = ?`,
    [deliveryId]
  );
  return rows[0] || null;
}

async function loadDeliveryByOrder(orderId, db = pool) {
  const [[row]] = await db.query(`SELECT id FROM deliveries WHERE order_id = ?`, [orderId]);
  return row ? loadDeliveryContext(row.id, db) : null;
}

/**
 * Fan one event out to whichever of buyer/vendor/rider it concerns:
 * an in-app notification for each account, plus an email where the
 * message is one a person would want in their inbox. Best-effort like
 * every notify()/sendEmail() call site: it runs after the real state
 * change has committed and never throws.
 */
async function announce(ctx, { buyer, vendor, rider }) {
  const ref = refOf(ctx);
  try {
    if (buyer) {
      if (ctx.buyer_id) {
        await notify({ userId: ctx.buyer_id, type: "delivery", title: buyer.title, message: buyer.message, link: "orders.html" });
      }
      const email = ctx.buyer_email || ctx.guest_email;
      if (buyer.emailIntro && email) {
        await sendEmail({
          to: email,
          subject: `${buyer.title}: VETRA order ${ref}`,
          html: buildOrderEmailHtml({
            greetingName: ctx.buyer_name || ctx.guest_name || "there",
            introHtml: `${buyer.emailIntro} <a href="${FRONTEND_URL}/track.html?code=${encodeURIComponent(ctx.tracking_code)}">Track it live</a>.`,
            ref, trackingCode: ctx.tracking_code, vendorStoreName: ctx.vendor_store_name,
            items: ctx.items, deliveryMethod: ctx.delivery_method, deliveryAddress: ctx.delivery_address,
            total: ctx.total, deliveryFee: ctx.delivery_fee,
            deliveryCode: buyer.includeCode ? ctx.delivery_code : null,
          }),
          logFallback: `delivery email for ${email}: ${ref} — ${buyer.title}`,
        });
      }
    }
    if (vendor) {
      // vendor/assets/notifications.js renders title/message as HTML
      // (unlike the buyer's page, which escapes), so anything that can
      // carry a rider name or an admin-typed reason is escaped here.
      await notify({ userId: ctx.vendor_id, type: "delivery", title: escapeHtml(vendor.title), message: escapeHtml(vendor.message), link: "orders.html" });
    }
    const riderId = rider?.userId || ctx.rider_id;
    if (rider && riderId) {
      await notify({ userId: riderId, type: "delivery", title: rider.title, message: rider.message, link: "index.html" });
      const riderEmail = rider.email || ctx.rider_email;
      if (rider.emailHtml && riderEmail) {
        await sendEmail({
          to: riderEmail,
          subject: `${rider.title}: ${ref}`,
          html: rider.emailHtml,
          logFallback: `rider email for ${riderEmail}: ${ref} — ${rider.title}`,
        });
      }
    }
  } catch (error) {
    console.error("Could not announce delivery event:", error.message);
  }
}

// ---------- Transitions ----------

/**
 * Atomically move a delivery from one of `from` to `to`, stamping the
 * matching *_at column. `extra` is additional column assignments
 * (plain values only). Returns false if the delivery wasn't in an
 * allowed state, so the caller can answer 409.
 */
async function moveDelivery(db, deliveryId, from, to, extra = {}, { riderId } = {}) {
  const sets = ["status = ?"];
  const params = [to];
  const tsColumn = STATUS_TIMESTAMP_COLUMN[to];
  if (tsColumn) sets.push(`${tsColumn} = NOW()`);
  for (const [column, value] of Object.entries(extra)) {
    sets.push(`${column} = ?`);
    params.push(value);
  }
  let where = "id = ? AND status IN (?)";
  params.push(deliveryId, from);
  if (riderId) {
    where += " AND rider_id = ?";
    params.push(riderId);
  }
  const [result] = await db.query(`UPDATE deliveries SET ${sets.join(", ")} WHERE ${where}`, params);
  return result.affectedRows === 1;
}

/** Mirror a delivery milestone onto orders.status, which every existing page already reads. */
async function syncOrderStatus(db, orderId, deliveryStatus) {
  switch (deliveryStatus) {
    case "ready":
    case "assigned":
    case "accepted":
      await db.query(`UPDATE orders SET status = 'processing' WHERE id = ? AND status = 'pending'`, [orderId]);
      break;
    case "picked_up":
      await db.query(`UPDATE orders SET status = 'shipped', shipped_at = COALESCE(shipped_at, NOW()) WHERE id = ?`, [orderId]);
      break;
    case "out_for_delivery":
      await db.query(
        `UPDATE orders SET status = 'out_for_delivery', shipped_at = COALESCE(shipped_at, NOW()), out_for_delivery_at = NOW() WHERE id = ?`,
        [orderId]
      );
      break;
    case "delivered":
      // Escrow stays 'held': it releases when the buyer confirms, or
      // when the auto-confirm window passes (runDeliveryCron below).
      await db.query(`UPDATE orders SET status = 'completed', delivered_at = NOW() WHERE id = ?`, [orderId]);
      break;
    case "returned":
    case "cancelled":
      await db.query(
        `UPDATE orders SET status = 'cancelled', cancelled_at = NOW(), escrow_status = 'refunded' WHERE id = ? AND status <> 'cancelled'`,
        [orderId]
      );
      break;
    default:
      break;
  }
}

function riderJobEmail(ctx) {
  return `
    <p>Hi ${escapeHtml(ctx.rider_name || "there")},</p>
    <p>You have a new delivery job, <strong>${refOf(ctx)}</strong>. Open the VETRA rider app to accept it within ${ASSIGNMENT_TIMEOUT_MINUTES} minutes.</p>
    <p><strong>Pick up:</strong> ${escapeHtml(ctx.vendor_store_name || "Vendor")}, ${escapeHtml(ctx.pickup_address || "address in app")} (${escapeHtml(ctx.pickup_state || "")})<br/>
       <strong>Drop off:</strong> ${escapeHtml(ctx.dropoff_state || "")}<br/>
       <strong>You earn:</strong> ${nairaLabel(ctx.rider_payout)}</p>
    <p><a href="${FRONTEND_URL}/rider/index.html">Open rider app</a></p>`;
}

/** Offer a delivery to a specific rider (admin dispatch, or auto-assign). */
async function assignRider(deliveryId, riderId, { actorUserId = null, actorRole = "system" } = {}) {
  const [[rider]] = await pool.query(
    `SELECT id, name, state FROM users WHERE id = ? AND role = 'rider' AND status = 'active'`,
    [riderId]
  );
  if (!rider) throw new DeliveryError("That rider isn't active.", 404);

  const before = await loadDeliveryContext(deliveryId);
  if (!before) throw new DeliveryError("Delivery not found.", 404);
  if (before.mode !== "vetra") throw new DeliveryError("The vendor is shipping this order themselves.", 409);

  const moved = await moveDelivery(pool, deliveryId, ["ready", "assigned", "accepted"], "assigned", {
    rider_id: riderId,
    accepted_at: null,
  });
  if (!moved) throw new DeliveryError("This delivery can't be assigned in its current state.", 409);

  await recordEvent(pool, {
    deliveryId,
    event: "assigned",
    note: `Offered to rider ${rider.name}${actorRole === "system" ? " (auto-assigned)" : ""}.`,
    publicNote: "Rider being assigned",
    actorUserId,
    actorRole,
  });
  await syncOrderStatus(pool, before.order_id, "assigned");

  // Reassigning away from a rider who'd already been offered it.
  if (before.rider_id && before.rider_id !== riderId) {
    await notify({
      userId: before.rider_id,
      type: "delivery",
      title: "Job reassigned",
      message: `Delivery ${refOf(before)} was reassigned to another rider.`,
      link: "index.html",
    });
  }

  const ctx = await loadDeliveryContext(deliveryId);
  await announce(ctx, {
    rider: {
      title: "New delivery job",
      message: `Pick up ${refOf(ctx)} from ${ctx.vendor_store_name || "the vendor"}. You earn ${nairaLabel(ctx.rider_payout)}.`,
      emailHtml: riderJobEmail(ctx),
    },
  });
  if (actorRole === "admin") {
    await logActivity({
      type: "delivery",
      message: `Assigned delivery for order <strong>${refOf(ctx)}</strong> to rider <strong>${escapeHtml(rider.name)}</strong>.`,
      actorUserId,
      targetType: "rider",
      targetId: riderId,
    });
  }
  return ctx;
}

/**
 * Pick the least-busy on-duty rider in the pickup state, skipping
 * anyone who already declined or let this job time out. Returns the
 * rider id assigned, or null when nobody is available (the delivery
 * then waits in the admin dispatch queue, and the sweep retries).
 */
async function tryAutoAssign(deliveryId) {
  const settings = await getDeliverySettings();
  if (!settings.autoAssignRiders) return null;

  const [[delivery]] = await pool.query(
    `SELECT id, status, mode, pickup_state FROM deliveries WHERE id = ?`,
    [deliveryId]
  );
  if (!delivery || delivery.mode !== "vetra" || delivery.status !== "ready" || !delivery.pickup_state) return null;

  const [candidates] = await pool.query(
    `SELECT u.id,
            (SELECT COUNT(*) FROM deliveries d2 WHERE d2.rider_id = u.id AND d2.status IN (?)) AS active_jobs
     FROM users u
     WHERE u.role = 'rider' AND u.status = 'active' AND u.rider_on_duty = TRUE AND u.state = ?
       AND u.id NOT IN (
         SELECT actor_user_id FROM delivery_events
         WHERE delivery_id = ? AND event IN ('declined', 'assignment_expired') AND actor_user_id IS NOT NULL
       )
     HAVING active_jobs < ?
     ORDER BY active_jobs ASC, u.last_activity_at DESC
     LIMIT 1`,
    [RIDER_ACTIVE_STATUSES, delivery.pickup_state, deliveryId, MAX_ACTIVE_JOBS_PER_RIDER]
  );
  if (!candidates[0]) return null;
  try {
    await assignRider(deliveryId, candidates[0].id, { actorRole: "system" });
    return candidates[0].id;
  } catch (error) {
    // Lost a race with a manual assignment or a cancellation, harmless.
    if (error instanceof DeliveryError) return null;
    throw error;
  }
}

// ---------- Vendor actions ----------

async function vendorMarkReady(orderId, vendorId) {
  const ctx = await loadDeliveryByOrder(orderId);
  if (!ctx || ctx.vendor_id !== vendorId) throw new DeliveryError("Delivery not found.", 404);
  if (ctx.mode !== "vetra") throw new DeliveryError("You're shipping this order yourself, use Update shipment instead.", 409);
  const moved = await moveDelivery(pool, ctx.id, ["awaiting_vendor"], "ready");
  if (!moved) throw new DeliveryError("This order is already with dispatch.", 409);

  await recordEvent(pool, {
    deliveryId: ctx.id,
    event: "ready",
    note: "Vendor packed the order and marked it ready for pickup.",
    publicNote: "Packed and ready for pickup",
    actorUserId: vendorId,
    actorRole: "vendor",
  });
  await syncOrderStatus(pool, orderId, "ready");
  await announce(ctx, {
    buyer: {
      title: "Order packed",
      message: `Your order ${refOf(ctx)} is packed and waiting for a VETRA rider.`,
    },
  });
  const riderId = await tryAutoAssign(ctx.id);
  return { riderAssigned: !!riderId };
}

async function vendorSwitchToSelfShip(orderId, vendorId) {
  const ctx = await loadDeliveryByOrder(orderId);
  if (!ctx || ctx.vendor_id !== vendorId) throw new DeliveryError("Delivery not found.", 404);
  if (ctx.mode === "self") return ctx;
  const moved = await moveDelivery(pool, ctx.id, PRE_PICKUP_STATUSES, "awaiting_vendor", { mode: "self", rider_id: null });
  if (!moved) throw new DeliveryError("A rider already has this parcel, it can't be switched now.", 409);

  await recordEvent(pool, {
    deliveryId: ctx.id,
    event: "self_ship",
    note: "Vendor chose to ship this order with their own courier.",
    publicNote: "Vendor is shipping with their own courier",
    actorUserId: vendorId,
    actorRole: "vendor",
  });
  if (ctx.rider_id) {
    await announce(ctx, {
      rider: { title: "Job cancelled", message: `The vendor is shipping ${refOf(ctx)} themselves, you no longer need to collect it.` },
    });
  }
  return ctx;
}

/** Self-ship orders: mirror the vendor's "Update shipment" choice onto the delivery row. */
async function syncSelfShipStatus(orderId, orderStatus, vendorId) {
  const map = { shipped: "picked_up", out_for_delivery: "out_for_delivery", completed: "delivered", cancelled: "cancelled" };
  const to = map[orderStatus];
  const [[delivery]] = await pool.query(`SELECT id, status FROM deliveries WHERE order_id = ? AND mode = 'self'`, [orderId]);
  if (!to || !delivery || delivery.status === to) return;
  await pool.query(
    `UPDATE deliveries SET status = ?, ${STATUS_TIMESTAMP_COLUMN[to]} = NOW() WHERE id = ?`,
    [to, delivery.id]
  );
  const labels = { picked_up: "Shipped by vendor", out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled" };
  await recordEvent(pool, {
    deliveryId: delivery.id,
    event: to,
    note: `Vendor updated the shipment: ${labels[to].toLowerCase()}.`,
    publicNote: labels[to],
    actorUserId: vendorId,
    actorRole: "vendor",
  });
}

/** Vendor cancels a VETRA-delivered order before the rider has it. Called from the shipment route. */
async function cancelDeliveryForOrder(orderId, { actorUserId, actorRole, reason }) {
  const ctx = await loadDeliveryByOrder(orderId);
  if (!ctx) return;
  if (["delivered", "returned", "cancelled"].includes(ctx.status)) return;
  const moved = await moveDelivery(pool, ctx.id, PRE_PICKUP_STATUSES, "cancelled", { rider_id: null });
  if (!moved) throw new DeliveryError("A rider already has this parcel, it can't be cancelled now. Contact VETRA support.", 409);
  await recordEvent(pool, {
    deliveryId: ctx.id,
    event: "cancelled",
    note: reason ? `Cancelled: ${String(reason).slice(0, 300)}` : "Delivery cancelled.",
    publicNote: "Order cancelled",
    actorUserId,
    actorRole,
  });
  if (ctx.rider_id) {
    await announce(ctx, { rider: { title: "Job cancelled", message: `Delivery ${refOf(ctx)} was cancelled, no pickup needed.` } });
  }
}

/** Pickup orders: the buyer reads their code to the vendor at the counter. */
async function vendorConfirmPickup(orderId, vendorId, code) {
  const [[order]] = await pool.query(
    `SELECT id, vendor_id, delivery_method, status, tracking_code, delivery_code, delivery_code_attempts FROM orders WHERE id = ?`,
    [orderId]
  );
  if (!order || order.vendor_id !== vendorId) throw new DeliveryError("Order not found.", 404);
  if (order.delivery_method !== "pickup") throw new DeliveryError("This order is for delivery, not pickup.");
  if (!["pending", "processing"].includes(order.status)) throw new DeliveryError("This order can't be handed over in its current state.", 409);
  await checkDeliveryCode(order, code);

  await pool.query(
    `UPDATE orders SET status = 'completed', delivered_at = NOW() WHERE id = ? AND status IN ('pending', 'processing')`,
    [orderId]
  );
  await logActivity({
    type: "order",
    message: `Order <strong>${orderRef(order)}</strong> collected by the buyer (pickup code verified).`,
    actorUserId: vendorId,
    targetType: "vendor",
    targetId: vendorId,
  });
  const [[o]] = await pool.query(`SELECT buyer_id FROM orders WHERE id = ?`, [orderId]);
  if (o?.buyer_id) {
    await notify({
      userId: o.buyer_id,
      type: "delivery",
      title: "Order collected",
      message: `You collected order ${orderRef(order)}. Confirm everything's right, or report an issue within the protection window.`,
      link: "orders.html",
    });
  }
}

/** Vendor confirms a returned parcel is back in their hands. */
async function vendorConfirmReturn(orderId, vendorId) {
  const ctx = await loadDeliveryByOrder(orderId);
  if (!ctx || ctx.vendor_id !== vendorId) throw new DeliveryError("Delivery not found.", 404);
  const moved = await moveDelivery(pool, ctx.id, ["returning"], "returned");
  if (!moved) throw new DeliveryError("This parcel isn't on its way back to you.", 409);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await syncOrderStatus(conn, orderId, "returned");
    // The goods are physically back on the shelf, so they go back into
    // sellable stock (and back to 'active' if that had hit zero).
    await conn.query(
      `UPDATE products p JOIN order_items oi ON oi.product_id = p.id
       SET p.stock_quantity = p.stock_quantity + oi.quantity,
           p.status = IF(p.status = 'out_of_stock', 'active', p.status)
       WHERE oi.order_id = ? AND oi.status = 'fulfilled'`,
      [orderId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await recordEvent(pool, {
    deliveryId: ctx.id,
    event: "returned",
    note: "Vendor confirmed the parcel is back. Order cancelled and stock restored.",
    publicNote: "Returned to vendor",
    actorUserId: vendorId,
    actorRole: "vendor",
  });
  // The rider is still paid for the return trip; the buyer gets everything back.
  await moneyHook("return payout", (payments) => payments.payRiderForDelivery(ctx.id));
  await moneyHook("return refund", (payments) => payments.refundOrder(orderId, "remaining", "Parcel couldn't be delivered and was returned to the vendor."));
  await announce(ctx, {
    buyer: {
      title: "Order returned",
      message: `Order ${refOf(ctx)} couldn't be delivered and went back to the vendor. If you paid for it, you'll be refunded in full.`,
      emailIntro: `We couldn't complete this delivery, so the parcel went back to the vendor and the order is cancelled. If you paid for it, the full amount is being refunded to ${refundDestination(ctx.payment_channel)}; banks usually take 5 to 10 working days to show it.`,
    },
    rider: { title: "Return confirmed", message: `The vendor confirmed they received ${refOf(ctx)} back.` },
  });
}

// ---------- Money hooks ----------

// Payouts and refunds (utils/payments.js) run after the delivery step
// they belong to has already happened, so a failure here is logged, not
// thrown: the rider's or vendor's action succeeded either way, and the
// payout or refund row (or the payments sweep) carries the retry.
// Required lazily: payments.js itself requires this module.
async function moneyHook(label, fn) {
  try {
    await fn(require("./payments"));
  } catch (err) {
    console.error(`[payments] ${label} failed:`, err.message);
  }
}

// ---------- Rider actions ----------

async function riderAccept(deliveryId, riderId) {
  const moved = await moveDelivery(pool, deliveryId, ["assigned"], "accepted", {}, { riderId });
  if (!moved) throw new DeliveryError("This job is no longer offered to you.", 409);
  const ctx = await loadDeliveryContext(deliveryId);
  await recordEvent(pool, {
    deliveryId,
    event: "accepted",
    note: `Rider ${ctx.rider_name} accepted and is heading to the vendor.`,
    publicNote: "Rider heading to pick up",
    actorUserId: riderId,
    actorRole: "rider",
  });
  await syncOrderStatus(pool, ctx.order_id, "accepted");
  await announce(ctx, {
    buyer: { title: "Rider assigned", message: `${ctx.rider_name} is collecting your order ${refOf(ctx)} from the vendor.` },
    vendor: {
      title: "Rider on the way",
      message: `${ctx.rider_name} is coming to collect ${refOf(ctx)}. Give them the pickup code shown on your Orders page.`,
    },
  });
  return ctx;
}

async function riderDecline(deliveryId, riderId, reason) {
  const moved = await moveDelivery(pool, deliveryId, ["assigned", "accepted"], "ready", { rider_id: null, accepted_at: null }, { riderId });
  if (!moved) throw new DeliveryError("This job is no longer yours to decline.", 409);
  await recordEvent(pool, {
    deliveryId,
    event: "declined",
    note: reason ? `Rider declined: ${String(reason).slice(0, 300)}` : "Rider declined the job.",
    actorUserId: riderId,
    actorRole: "rider",
  });
  await tryAutoAssign(deliveryId);
}

async function riderPickup(deliveryId, riderId, pickupCode) {
  const ctx = await loadDeliveryContext(deliveryId);
  if (!ctx || ctx.rider_id !== riderId) throw new DeliveryError("Job not found.", 404);
  if (ctx.status !== "accepted") throw new DeliveryError("Accept the job before picking it up.", 409);
  if (String(pickupCode || "").trim() !== ctx.pickup_code) {
    throw new DeliveryError("That pickup code doesn't match. Ask the vendor to read it from their Orders page.");
  }
  const moved = await moveDelivery(pool, deliveryId, ["accepted"], "picked_up", {}, { riderId });
  if (!moved) throw new DeliveryError("This job changed while you were updating it, refresh and try again.", 409);
  await recordEvent(pool, {
    deliveryId,
    event: "picked_up",
    note: `Rider ${ctx.rider_name} collected the parcel from the vendor.`,
    publicNote: "Picked up from vendor",
    actorUserId: riderId,
    actorRole: "rider",
  });
  await syncOrderStatus(pool, ctx.order_id, "picked_up");
  await announce(ctx, {
    buyer: { title: "Order picked up", message: `Your order ${refOf(ctx)} has left the vendor with ${ctx.rider_name}.` },
    vendor: { title: "Parcel collected", message: `${ctx.rider_name} collected ${refOf(ctx)}.` },
  });
}

async function riderDepart(deliveryId, riderId) {
  const moved = await moveDelivery(pool, deliveryId, ["picked_up"], "out_for_delivery", {}, { riderId });
  if (!moved) throw new DeliveryError("Pick the parcel up before starting the delivery.", 409);
  const ctx = await loadDeliveryContext(deliveryId);
  await recordEvent(pool, {
    deliveryId,
    event: "out_for_delivery",
    note: `Rider ${ctx.rider_name} is on the way to the buyer${ctx.failed_attempts ? ` (attempt ${ctx.failed_attempts + 1})` : ""}.`,
    publicNote: "Out for delivery",
    actorUserId: riderId,
    actorRole: "rider",
  });
  await syncOrderStatus(pool, ctx.order_id, "out_for_delivery");
  await announce(ctx, {
    buyer: {
      title: "Out for delivery",
      message: `${ctx.rider_name} is on the way with order ${refOf(ctx)}. Have your delivery code ready.`,
      emailIntro: `<strong>${escapeHtml(ctx.rider_name)}</strong> is on the way with your order${ctx.rider_phone ? ` (${escapeHtml(ctx.rider_phone)})` : ""}.`,
      includeCode: true,
    },
  });
}

/** Compares a buyer code, counting wrong guesses so a 6-digit code can't be brute-forced. */
async function checkDeliveryCode(order, code) {
  if (!order.delivery_code) throw new DeliveryError("This order has no delivery code. Contact VETRA support.", 409);
  if (order.delivery_code_attempts >= MAX_DELIVERY_CODE_ATTEMPTS) {
    throw new DeliveryError("Too many wrong codes. This order is locked, contact VETRA support to unlock it.", 423);
  }
  if (String(code || "").trim() !== order.delivery_code) {
    await pool.query(`UPDATE orders SET delivery_code_attempts = delivery_code_attempts + 1 WHERE id = ?`, [order.id]);
    const left = MAX_DELIVERY_CODE_ATTEMPTS - order.delivery_code_attempts - 1;
    throw new DeliveryError(left > 0 ? `Wrong code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Wrong code. This order is now locked, contact VETRA support.");
  }
}

async function riderDeliver(deliveryId, riderId, { code, photoUrl }) {
  const ctx = await loadDeliveryContext(deliveryId);
  if (!ctx || ctx.rider_id !== riderId) throw new DeliveryError("Job not found.", 404);
  if (ctx.status !== "out_for_delivery") throw new DeliveryError("Start the delivery before completing it.", 409);
  const [[order]] = await pool.query(
    `SELECT id, delivery_code, delivery_code_attempts FROM orders WHERE id = ?`,
    [ctx.order_id]
  );
  await checkDeliveryCode(order, code);

  const moved = await moveDelivery(pool, deliveryId, ["out_for_delivery"], "delivered", { proof_photo_url: photoUrl || null }, { riderId });
  if (!moved) throw new DeliveryError("This job changed while you were updating it, refresh and try again.", 409);
  await recordEvent(pool, {
    deliveryId,
    event: "delivered",
    note: `Delivered by ${ctx.rider_name}, buyer's code verified.`,
    publicNote: "Delivered",
    actorUserId: riderId,
    actorRole: "rider",
  });
  await syncOrderStatus(pool, ctx.order_id, "delivered");
  // The buyer's code is the proof of delivery, so the rider is paid now,
  // independent of when the vendor's escrow releases.
  await moneyHook("rider payout", (payments) => payments.payRiderForDelivery(deliveryId));

  const { autoConfirmHours } = await getDeliverySettings();
  await announce(ctx, {
    buyer: {
      title: "Delivered",
      message: `Order ${refOf(ctx)} was delivered. Confirm it's all good, or report an issue within ${autoConfirmHours} hours.`,
      emailIntro: `Your order was delivered. If everything's right, confirm it from your Orders page. If something's wrong, report it within <strong>${autoConfirmHours} hours</strong> and your payment stays in escrow while we review.`,
    },
    vendor: {
      title: "Order delivered",
      message: `${refOf(ctx)} was delivered. Funds release once the buyer confirms, or automatically after ${autoConfirmHours} hours.`,
    },
  });
}

async function riderFailAttempt(deliveryId, riderId, { reason, note }) {
  if (!FAILURE_REASONS[reason]) throw new DeliveryError(`reason must be one of: ${Object.keys(FAILURE_REASONS).join(", ")}`);
  const ctx = await loadDeliveryContext(deliveryId);
  if (!ctx || ctx.rider_id !== riderId) throw new DeliveryError("Job not found.", 404);
  if (!["picked_up", "out_for_delivery"].includes(ctx.status)) throw new DeliveryError("Only an in-progress delivery can fail.", 409);

  const { maxDeliveryAttempts } = await getDeliverySettings();
  const attempts = ctx.failed_attempts + 1;
  // A refusal is final: there's no point trying a buyer who said no.
  const sendBack = reason === "refused" || attempts >= maxDeliveryAttempts;
  const label = FAILURE_REASONS[reason] + (note ? `: ${String(note).slice(0, 200)}` : "");

  const moved = await moveDelivery(pool, deliveryId, ["picked_up", "out_for_delivery"], sendBack ? "returning" : "picked_up", {
    failed_attempts: attempts,
    last_failure_reason: label.slice(0, 255),
  }, { riderId });
  if (!moved) throw new DeliveryError("This job changed while you were updating it, refresh and try again.", 409);

  await recordEvent(pool, {
    deliveryId,
    event: "attempt_failed",
    note: `Attempt ${attempts} failed: ${label}.`,
    publicNote: `Delivery attempt ${attempts} unsuccessful`,
    actorUserId: riderId,
    actorRole: "rider",
  });
  if (sendBack) {
    await recordEvent(pool, {
      deliveryId,
      event: "returning",
      note: reason === "refused" ? "Buyer refused the parcel, returning to vendor." : `${attempts} failed attempts, returning to vendor.`,
      publicNote: "Returning to vendor",
      actorRole: "system",
    });
  }
  // Either way the rider is no longer en route to the buyer, so the
  // order steps back to 'shipped' rather than claiming it's still out
  // for delivery while the rider retries later or heads back.
  await pool.query(`UPDATE orders SET status = 'shipped' WHERE id = ? AND status = 'out_for_delivery'`, [ctx.order_id]);

  await announce(ctx, {
    buyer: sendBack
      ? {
          title: "Delivery unsuccessful",
          message: `We couldn't deliver ${refOf(ctx)} (${FAILURE_REASONS[reason].toLowerCase()}), so it's going back to the vendor. You'll be refunded once it's back with them.`,
          emailIntro: `We couldn't deliver this order (${escapeHtml(FAILURE_REASONS[reason].toLowerCase())}), so it's going back to the vendor and will be cancelled. You'll be refunded in full once it's back with them.`,
        }
      : {
          title: "Missed delivery",
          message: `${ctx.rider_name} couldn't deliver ${refOf(ctx)} (${FAILURE_REASONS[reason].toLowerCase()}). They'll try again, keep your phone on.`,
          emailIntro: `Our rider couldn't complete the delivery (${escapeHtml(FAILURE_REASONS[reason].toLowerCase())}). They'll try again${ctx.rider_phone ? `, you can reach them on ${escapeHtml(ctx.rider_phone)}` : ""}. Attempt ${attempts} of ${maxDeliveryAttempts}.`,
          includeCode: true,
        },
    vendor: sendBack
      ? { title: "Parcel coming back", message: `${refOf(ctx)} couldn't be delivered and is being returned to you. Confirm when you receive it.` }
      : null,
  });
  return { returning: sendBack, attempts };
}

async function riderUpdateLocation(riderId, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new DeliveryError("lat and lng must be valid coordinates.");
  }
  // Only jobs the rider is actually moving on; a location is never
  // stored against a delivery the rider isn't carrying.
  const [result] = await pool.query(
    `UPDATE deliveries SET rider_lat = ?, rider_lng = ?, rider_location_at = NOW()
     WHERE rider_id = ? AND status IN ('accepted', 'picked_up', 'out_for_delivery', 'returning')`,
    [lat, lng, riderId]
  );
  return result.affectedRows;
}

// ---------- Escrow ----------

/**
 * Release a completed order's escrow to the vendor. `by` is 'buyer'
 * (they tapped "I received it") or 'auto' (the sweep, after the
 * protection window). Guarded so a buyer confirm and the sweep racing
 * each other release exactly once.
 */
async function releaseEscrow(orderId, by) {
  const [result] = await pool.query(
    `UPDATE orders SET escrow_status = 'released', escrow_released_at = NOW(),
       buyer_confirmed_at = COALESCE(buyer_confirmed_at, NOW())
     WHERE id = ? AND status = 'completed' AND escrow_status = 'held'`,
    [orderId]
  );
  if (result.affectedRows !== 1) return false;

  const [[order]] = await pool.query(`SELECT id, vendor_id, total, tracking_code FROM orders WHERE id = ?`, [orderId]);
  const ref = orderRef(order);
  await logActivity({
    type: "order",
    message: by === "buyer"
      ? `Buyer confirmed receipt of <strong>${ref}</strong>, escrow released.`
      : `Escrow for <strong>${ref}</strong> auto-released after the buyer protection window.`,
    targetType: "vendor",
    targetId: order.vendor_id,
  });
  await notify({
    userId: order.vendor_id,
    type: "order",
    title: "Funds released",
    message: `${nairaLabel(order.total)} for ${ref} was released from escrow${by === "buyer" ? ", the buyer confirmed receipt" : ""}.`,
    link: "earnings.html",
  });
  const [[delivery]] = await pool.query(`SELECT id FROM deliveries WHERE order_id = ?`, [orderId]);
  if (delivery) {
    await recordEvent(pool, {
      deliveryId: delivery.id,
      event: "confirmed",
      note: by === "buyer" ? "Buyer confirmed receipt." : "Auto-confirmed after the protection window.",
      publicNote: "Receipt confirmed",
      actorRole: by === "buyer" ? "buyer" : "system",
    });
  }
  await moneyHook("vendor payout", (payments) => payments.payVendorForOrder(orderId));
  return true;
}

// ---------- Scheduled sweep ----------

/**
 * Everything time-based in the delivery system. Run by
 * scripts/delivery-cron.js from a cPanel cron job (every 10 minutes
 * is plenty), or via POST /api/delivery/cron on a host without cron.
 * Safe to run concurrently or repeatedly: every step is a guarded
 * UPDATE.
 */
async function runDeliveryCron() {
  const settings = await getDeliverySettings();
  const summary = { escrowReleased: 0, assignmentsExpired: 0, autoAssigned: 0 };

  // 1. Escrow auto-release, skipping any order with an open report:
  //    a dispute freezes the money until an admin resolves it.
  const [due] = await pool.query(
    `SELECT o.id FROM orders o
     WHERE o.status = 'completed' AND o.escrow_status = 'held' AND o.delivered_at IS NOT NULL
       AND o.delivered_at < NOW() - INTERVAL ? HOUR
       AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.order_id = o.id AND r.status = 'open')
     LIMIT 500`,
    [settings.autoConfirmHours]
  );
  for (const row of due) {
    if (await releaseEscrow(row.id, "auto")) summary.escrowReleased += 1;
  }

  // 2. Offers nobody accepted in time go back to the queue.
  const [stale] = await pool.query(
    `SELECT id, rider_id FROM deliveries
     WHERE status = 'assigned' AND assigned_at < NOW() - INTERVAL ? MINUTE`,
    [ASSIGNMENT_TIMEOUT_MINUTES]
  );
  for (const d of stale) {
    const moved = await moveDelivery(pool, d.id, ["assigned"], "ready", { rider_id: null });
    if (!moved) continue;
    summary.assignmentsExpired += 1;
    await recordEvent(pool, {
      deliveryId: d.id,
      event: "assignment_expired",
      note: `Rider didn't accept within ${ASSIGNMENT_TIMEOUT_MINUTES} minutes, back in the queue.`,
      actorUserId: d.rider_id,
      actorRole: "system",
    });
    await notify({ userId: d.rider_id, type: "delivery", title: "Job offer expired", message: "A job you didn't accept in time went to another rider.", link: "index.html" });
  }

  // 3. Retry auto-assign for anything still waiting (a rider may have
  //    come on duty since the vendor marked it ready).
  if (settings.autoAssignRiders) {
    const [waiting] = await pool.query(`SELECT id FROM deliveries WHERE status = 'ready' AND mode = 'vetra' ORDER BY ready_at LIMIT 200`);
    for (const d of waiting) {
      if (await tryAutoAssign(d.id)) summary.autoAssigned += 1;
    }
  }
  return summary;
}

module.exports = {
  DeliveryError,
  FAILURE_REASONS,
  RIDER_ACTIVE_STATUSES,
  PRE_PICKUP_STATUSES,
  MAX_DELIVERY_CODE_ATTEMPTS,
  newDeliveryCode,
  getDeliverySettings,
  quoteDelivery,
  createDeliveryForOrder,
  recordEvent,
  loadDeliveryContext,
  loadDeliveryByOrder,
  assignRider,
  tryAutoAssign,
  moveDelivery,
  syncOrderStatus,
  vendorMarkReady,
  vendorSwitchToSelfShip,
  syncSelfShipStatus,
  cancelDeliveryForOrder,
  vendorConfirmPickup,
  vendorConfirmReturn,
  riderAccept,
  riderDecline,
  riderPickup,
  riderDepart,
  riderDeliver,
  riderFailAttempt,
  riderUpdateLocation,
  releaseEscrow,
  runDeliveryCron,
  announce,
};
