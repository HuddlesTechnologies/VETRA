/* =========================================================
   /api/delivery: VETRA's last-mile delivery layer.

   - Public: fee quote (cart page) and tracking-code lookup (track.html)
   - Buyer: delivery detail for their own order, "I received it"
   - Vendor: mark ready for pickup, ship it myself, pickup-order
     handover, confirm a returned parcel
   - Rider: duty toggle, jobs, accept/decline/pickup/depart/deliver/
     fail, live location
   - Admin: dispatch queue, rider management, rates and settings,
     rider payouts
   - Cron: the scheduled sweep, for hosts without a real cron

   Routes here only validate input and check who's asking. Every state
   change goes through src/utils/delivery.js.
   ========================================================= */

const crypto = require("crypto");
const express = require("express");
const pool = require("../db");
const { newId, orderRef } = require("../utils/id");
const { requireAuth, requireRole, requireAdminRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");
const { escapeHtml } = require("../utils/escapeHtml");
const { hashPassword } = require("../utils/password");
const { NIGERIAN_STATES } = require("../utils/nigerianStates");
const { createAndEmailPasswordReset } = require("../utils/passwordReset");
const { deliveryPublicLimiter, deliveryCodeLimiter } = require("../middleware/rateLimit");
const delivery = require("../utils/delivery");
const payments = require("../utils/payments");
const { payoutAccountRouter } = require("../utils/payoutAccount");
const { safeHttpsUrl } = require("../utils/safeUrl");

const router = express.Router();

const RIDER_VEHICLES = ["bicycle", "motorbike", "car", "van"];
const MANAGERS = ["Super Admin", "Moderator"];

// A rider's location is only worth showing while it's fresh.
const LOCATION_FRESH_MINUTES = 15;

function freshLocation(d) {
  if (!d.rider_location_at || d.rider_lat == null) return null;
  const ageMs = Date.now() - new Date(d.rider_location_at).getTime();
  if (ageMs > LOCATION_FRESH_MINUTES * 60 * 1000) return null;
  return { lat: Number(d.rider_lat), lng: Number(d.rider_lng), at: d.rider_location_at };
}

async function loadEvents(deliveryId, { publicOnly = false } = {}) {
  const [rows] = await pool.query(
    publicOnly
      ? `SELECT event, public_note AS note, created_at FROM delivery_events
         WHERE delivery_id = ? AND public_note IS NOT NULL ORDER BY created_at, id`
      : `SELECT e.event, e.note, e.actor_role, e.created_at, u.name AS actor_name
         FROM delivery_events e LEFT JOIN users u ON u.id = e.actor_user_id
         WHERE e.delivery_id = ? ORDER BY e.created_at, e.id`,
    [deliveryId]
  );
  return rows;
}

// ======================= Public =======================

// Cart page fee preview. Checkout recomputes this itself, so the number
// here is only ever informational.
router.get(
  "/quote",
  deliveryPublicLimiter,
  asyncHandler(async (req, res) => {
    const { vendorId, state } = req.query;
    if (!vendorId || !state) return res.status(400).json({ error: "vendorId and state are required." });
    const subtotal = Math.max(0, Number(req.query.subtotal) || 0);
    res.json(await delivery.quoteDelivery({ vendorId, state, subtotal }));
  })
);

// track.html, for guests and anyone the buyer shares the code with. The
// tracking code is 8 random characters, so it works as a bearer secret,
// but this still returns nothing personal: no address, phone, buyer
// name, or delivery code. Rider first name and live position are shown
// only while the parcel is actually on its way.
router.get(
  "/track/:code",
  deliveryPublicLimiter,
  asyncHandler(async (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    const [[order]] = await pool.query(
      `SELECT o.id, o.tracking_code, o.status, o.delivery_method, o.delivery_state, o.created_at,
              o.delivered_at, o.cancelled_at, v.store_name AS vendor_name
       FROM orders o JOIN users v ON v.id = o.vendor_id WHERE o.tracking_code = ?`,
      [code]
    );
    if (!order) return res.status(404).json({ error: "No order matches that tracking code." });

    const [[d]] = await pool.query(
      `SELECT d.*, r.name AS rider_name, r.rider_vehicle FROM deliveries d
       LEFT JOIN users r ON r.id = d.rider_id WHERE d.order_id = ?`,
      [order.id]
    );
    const enRoute = d && ["picked_up", "out_for_delivery"].includes(d.status);
    res.json({
      trackingCode: order.tracking_code,
      orderStatus: order.status,
      deliveryMethod: order.delivery_method,
      destinationState: order.delivery_state,
      vendorName: order.vendor_name,
      placedAt: order.created_at,
      deliveredAt: order.delivered_at,
      delivery: d
        ? {
            status: d.status,
            mode: d.mode,
            failedAttempts: d.failed_attempts,
            rider: enRoute && d.rider_name ? { firstName: d.rider_name.split(" ")[0], vehicle: d.rider_vehicle } : null,
            location: d.status === "out_for_delivery" ? freshLocation(d) : null,
            events: await loadEvents(d.id, { publicOnly: true }),
          }
        : null,
    });
  })
);

// Time-based work (escrow auto-release, expired rider offers, auto-
// assign retries) for hosts where scripts/delivery-cron.js can't be
// scheduled directly. Disabled unless CRON_SECRET is set.
router.post(
  "/cron",
  asyncHandler(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const given = String(req.get("x-cron-secret") || "");
    if (!secret || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
      return res.status(404).json({ error: "Not found." });
    }
    const deliverySummary = await delivery.runDeliveryCron();
    res.json({ ...deliverySummary, payments: await payments.runPaymentsCron() });
  })
);

// ======================= Buyer / vendor / admin: one order =======================

// The delivery panel on customer/orders.html, vendor/orders.html, and
// admin/deliveries.html. Each role sees a different slice: only the
// buyer ever sees their own delivery code, only the vendor and admin
// see the pickup code.
router.get(
  "/orders/:orderId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [[order]] = await pool.query(
      `SELECT id, buyer_id, vendor_id, status, escrow_status, delivery_method, delivery_fee, delivery_code,
              delivery_code_attempts, delivered_at, buyer_confirmed_at
       FROM orders WHERE id = ?`,
      [req.params.orderId]
    );
    if (!order) return res.status(404).json({ error: "Order not found." });
    const { role, id: userId } = req.user;
    const isBuyer = role === "buyer" && order.buyer_id === userId;
    const isVendor = role === "vendor" && order.vendor_id === userId;
    if (!isBuyer && !isVendor && role !== "admin") return res.status(404).json({ error: "Order not found." });

    const settings = await delivery.getDeliverySettings();
    const ctx = await delivery.loadDeliveryByOrder(order.id);
    const showRider = ctx && ctx.rider_id && !["assigned", "delivered", "returned", "cancelled"].includes(ctx.status);
    const confirmDeadline = order.delivered_at && order.escrow_status === "held"
      ? new Date(new Date(order.delivered_at).getTime() + settings.autoConfirmHours * 3600 * 1000)
      : null;

    res.json({
      orderId: order.id,
      orderStatus: order.status,
      escrowStatus: order.escrow_status,
      deliveryMethod: order.delivery_method,
      deliveryFee: order.delivery_fee,
      deliveryCode: isBuyer && !["completed", "cancelled"].includes(order.status) ? order.delivery_code : undefined,
      codeLocked: order.delivery_code_attempts >= delivery.MAX_DELIVERY_CODE_ATTEMPTS,
      buyerConfirmedAt: order.buyer_confirmed_at,
      confirmDeadline,
      canConfirm: isBuyer && order.status === "completed" && order.escrow_status === "held",
      delivery: ctx
        ? {
            id: ctx.id,
            status: ctx.status,
            mode: ctx.mode,
            pickupCode: isVendor || role === "admin" ? ctx.pickup_code : undefined,
            failedAttempts: ctx.failed_attempts,
            lastFailureReason: ctx.last_failure_reason,
            proofPhotoUrl: ctx.proof_photo_url,
            fee: ctx.fee_charged,
            riderPayout: role === "admin" ? ctx.rider_payout : undefined,
            rider: showRider
              ? { name: ctx.rider_name, phone: ctx.rider_phone, vehicle: ctx.rider_vehicle, plate: ctx.rider_plate }
              : null,
            location: ["accepted", "picked_up", "out_for_delivery"].includes(ctx.status) ? freshLocation(ctx) : null,
            // Buyers get the customer-facing wording; the detailed notes
            // ("Rider X declined: ...") are for the vendor and dispatch.
            events: await loadEvents(ctx.id, { publicOnly: isBuyer }),
          }
        : null,
    });
  })
);

router.post(
  "/orders/:orderId/confirm",
  requireAuth,
  requireRole("buyer"),
  asyncHandler(async (req, res) => {
    const [[order]] = await pool.query(`SELECT buyer_id FROM orders WHERE id = ?`, [req.params.orderId]);
    if (!order || order.buyer_id !== req.user.id) return res.status(404).json({ error: "Order not found." });
    const released = await delivery.releaseEscrow(req.params.orderId, "buyer");
    if (!released) return res.status(409).json({ error: "This order isn't waiting for your confirmation." });
    res.json({ ok: true });
  })
);

// ======================= Vendor =======================

router.post(
  "/orders/:orderId/ready",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    res.json({ ok: true, ...(await delivery.vendorMarkReady(req.params.orderId, req.user.id)) });
  })
);

router.post(
  "/orders/:orderId/self-ship",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    await delivery.vendorSwitchToSelfShip(req.params.orderId, req.user.id);
    res.json({ ok: true });
  })
);

router.post(
  "/orders/:orderId/pickup-complete",
  requireAuth,
  requireRole("vendor"),
  deliveryCodeLimiter,
  asyncHandler(async (req, res) => {
    await delivery.vendorConfirmPickup(req.params.orderId, req.user.id, req.body.code);
    res.json({ ok: true });
  })
);

router.post(
  "/orders/:orderId/return-received",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    await delivery.vendorConfirmReturn(req.params.orderId, req.user.id);
    res.json({ ok: true });
  })
);

// ======================= Rider =======================

const rider = express.Router();
rider.use(requireAuth, requireRole("rider"));
// The bank account automatic payouts go to, shared with vendors.
rider.use("/payout-account", payoutAccountRouter("rider"));

const RIDER_JOB_SELECT = `
  SELECT d.id, d.order_id, d.status, d.pickup_address, d.pickup_state, d.pickup_phone,
         d.dropoff_address, d.dropoff_state, d.dropoff_phone, d.recipient_name,
         d.rider_payout, d.rider_paid_at, d.failed_attempts, d.last_failure_reason,
         d.assigned_at, d.accepted_at, d.picked_up_at, d.out_for_delivery_at, d.delivered_at, d.returned_at,
         o.tracking_code, o.delivery_notes, v.store_name AS vendor_name,
         po.status AS payout_status, po.failure_reason AS payout_failure_reason,
         (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'fulfilled') AS item_count
  FROM deliveries d JOIN orders o ON o.id = d.order_id JOIN users v ON v.id = o.vendor_id
  LEFT JOIN payouts po ON po.kind = 'rider' AND po.delivery_id = d.id`;

// Before accepting, a rider sees where and how much, not who: the
// buyer's address and phone are only released once they commit.
function shapeRiderJob(job) {
  const committed = job.status !== "assigned";
  return {
    ...job,
    ref: orderRef({ id: job.order_id, tracking_code: job.tracking_code }),
    dropoff_address: committed ? job.dropoff_address : null,
    dropoff_phone: committed ? job.dropoff_phone : null,
    recipient_name: committed ? job.recipient_name : null,
    delivery_notes: committed ? job.delivery_notes : null,
  };
}

rider.get(
  "/me",
  asyncHandler(async (req, res) => {
    const [[me]] = await pool.query(
      `SELECT id, name, email, phone, state, avatar_url, rider_vehicle, rider_plate, rider_on_duty FROM users WHERE id = ?`,
      [req.user.id]
    );
    const [[stats]] = await pool.query(
      `SELECT
         SUM(status = 'delivered') AS delivered,
         SUM(status = 'returned') AS returned,
         SUM(status IN (?)) AS active,
         COALESCE(SUM(CASE WHEN status IN ('delivered', 'returned') AND rider_paid_at IS NULL THEN rider_payout END), 0) AS unpaid,
         COALESCE(SUM(CASE WHEN status IN ('delivered', 'returned') AND rider_paid_at IS NOT NULL THEN rider_payout END), 0) AS paid,
         COALESCE(SUM(CASE WHEN status = 'delivered' AND delivered_at >= CURDATE() THEN rider_payout END), 0) AS today
       FROM deliveries WHERE rider_id = ?`,
      [delivery.RIDER_ACTIVE_STATUSES, req.user.id]
    );
    res.json({
      ...me,
      rider_on_duty: !!me.rider_on_duty,
      stats: {
        delivered: Number(stats.delivered || 0),
        returned: Number(stats.returned || 0),
        active: Number(stats.active || 0),
        unpaidEarnings: Number(stats.unpaid),
        paidEarnings: Number(stats.paid),
        todayEarnings: Number(stats.today),
      },
    });
  })
);

// A rider becoming available in a state (coming on duty, or moving their
// area while on duty) is the moment a parcel waiting there can finally be
// matched, so try straight away rather than waiting for the next sweep.
async function matchWaitingParcels(state) {
  const [waiting] = await pool.query(
    `SELECT id FROM deliveries WHERE status = 'ready' AND mode = 'vetra' AND pickup_state = ? ORDER BY ready_at LIMIT 5`,
    [state]
  );
  for (const d of waiting) await delivery.tryAutoAssign(d.id);
}

rider.patch(
  "/duty",
  asyncHandler(async (req, res) => {
    if (typeof req.body.onDuty !== "boolean") return res.status(400).json({ error: "onDuty must be a boolean." });
    await pool.query(`UPDATE users SET rider_on_duty = ? WHERE id = ?`, [req.body.onDuty, req.user.id]);
    if (req.body.onDuty) {
      const [[me]] = await pool.query(`SELECT state FROM users WHERE id = ?`, [req.user.id]);
      await matchWaitingParcels(me.state);
    }
    res.json({ ok: true, onDuty: req.body.onDuty });
  })
);

// The rider's own choice of which state they take jobs in (users.state,
// what auto-assign and the dispatch rider list match against). Refused
// while they hold any job, offers included, so nothing they already have
// ends up belonging to an area they've left.
rider.patch(
  "/zone",
  asyncHandler(async (req, res) => {
    const state = req.body.state;
    if (!NIGERIAN_STATES.includes(state)) return res.status(400).json({ error: "Choose a valid state." });
    const [[me]] = await pool.query(`SELECT name, state, rider_on_duty FROM users WHERE id = ?`, [req.user.id]);
    if (me.state === state) return res.json({ ok: true, state });
    const [[{ live }]] = await pool.query(
      `SELECT COUNT(*) AS live FROM deliveries WHERE rider_id = ? AND status IN (?)`,
      [req.user.id, delivery.RIDER_ACTIVE_STATUSES]
    );
    if (Number(live)) {
      return res.status(409).json({ error: "Finish your active deliveries and accept or decline any job offers before changing your area." });
    }
    await pool.query(`UPDATE users SET state = ? WHERE id = ?`, [state, req.user.id]);
    await logActivity({
      type: "delivery",
      message: `Rider <strong>${escapeHtml(me.name)}</strong> moved their delivery area from ${escapeHtml(me.state || "none")} to ${escapeHtml(state)}.`,
      actorUserId: req.user.id,
      targetType: "rider",
      targetId: req.user.id,
    });
    if (me.rider_on_duty) await matchWaitingParcels(state);
    res.json({ ok: true, state });
  })
);

rider.get(
  "/jobs",
  asyncHandler(async (req, res) => {
    const [jobs] = await pool.query(
      `${RIDER_JOB_SELECT} WHERE d.rider_id = ? AND d.status IN (?) ORDER BY FIELD(d.status, 'assigned') DESC, d.assigned_at`,
      [req.user.id, delivery.RIDER_ACTIVE_STATUSES]
    );
    res.json(jobs.map(shapeRiderJob));
  })
);

rider.get(
  "/history",
  asyncHandler(async (req, res) => {
    const [jobs] = await pool.query(
      `${RIDER_JOB_SELECT} WHERE d.rider_id = ? AND d.status IN ('delivered', 'returned')
       ORDER BY COALESCE(d.delivered_at, d.returned_at) DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(jobs.map(shapeRiderJob));
  })
);

rider.post("/jobs/:id/accept", asyncHandler(async (req, res) => {
  await delivery.riderAccept(req.params.id, req.user.id);
  res.json({ ok: true });
}));

rider.post("/jobs/:id/decline", asyncHandler(async (req, res) => {
  await delivery.riderDecline(req.params.id, req.user.id, req.body.reason);
  res.json({ ok: true });
}));

rider.post("/jobs/:id/pickup", deliveryCodeLimiter, asyncHandler(async (req, res) => {
  await delivery.riderPickup(req.params.id, req.user.id, req.body.pickupCode);
  res.json({ ok: true });
}));

rider.post("/jobs/:id/depart", asyncHandler(async (req, res) => {
  await delivery.riderDepart(req.params.id, req.user.id);
  res.json({ ok: true });
}));

rider.post("/jobs/:id/deliver", deliveryCodeLimiter, asyncHandler(async (req, res) => {
  const photoUrl = req.body.photoUrl ? safeHttpsUrl(req.body.photoUrl) : null;
  await delivery.riderDeliver(req.params.id, req.user.id, { code: req.body.code, photoUrl });
  res.json({ ok: true });
}));

rider.post("/jobs/:id/fail", asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await delivery.riderFailAttempt(req.params.id, req.user.id, { reason: req.body.reason, note: req.body.note })) });
}));

rider.post("/location", asyncHandler(async (req, res) => {
  const updated = await delivery.riderUpdateLocation(req.user.id, Number(req.body.lat), Number(req.body.lng));
  res.json({ ok: true, updated });
}));

router.use("/rider", rider);

// ======================= Admin =======================

const admin = express.Router();
admin.use(requireAuth, requireRole("admin"));

admin.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const [byStatus] = await pool.query(`SELECT status, COUNT(*) AS count FROM deliveries GROUP BY status`);
    const [[riders]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(rider_on_duty AND status = 'active') AS on_duty
       FROM users WHERE role = 'rider' AND status <> 'deleted'`
    );
    const [[locked]] = await pool.query(
      `SELECT COUNT(*) AS count FROM orders WHERE delivery_code_attempts >= ? AND status NOT IN ('completed', 'cancelled')`,
      [delivery.MAX_DELIVERY_CODE_ATTEMPTS]
    );
    res.json({
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.count)])),
      riders: { total: Number(riders.total || 0), onDuty: Number(riders.on_duty || 0) },
      lockedCodes: Number(locked.count),
      settings: await delivery.getDeliverySettings(),
    });
  })
);

admin.get(
  "/deliveries",
  asyncHandler(async (req, res) => {
    const clauses = ["1 = 1"];
    const params = [];
    const groups = {
      queue: ["ready"],
      offered: ["assigned"],
      active: ["accepted", "picked_up", "out_for_delivery"],
      problem: ["returning"],
      packing: ["awaiting_vendor"],
      done: ["delivered", "returned", "cancelled"],
    };
    if (req.query.group && groups[req.query.group]) {
      clauses.push("d.status IN (?)");
      params.push(groups[req.query.group]);
    }
    if (req.query.state && NIGERIAN_STATES.includes(req.query.state)) {
      clauses.push("d.pickup_state = ?");
      params.push(req.query.state);
    }
    if (req.query.q) {
      const q = String(req.query.q).trim().toUpperCase().replace(/^VTR-?/, "");
      clauses.push("(o.tracking_code = ? OR UPPER(LEFT(o.id, 8)) = ?)");
      params.push(String(req.query.q).trim().toUpperCase(), q.slice(0, 8));
    }
    const [rows] = await pool.query(
      `SELECT d.id, d.order_id, d.status, d.mode, d.pickup_state, d.dropoff_state, d.pickup_address, d.dropoff_address,
              d.fee_charged, d.rider_payout, d.failed_attempts, d.last_failure_reason, d.rider_id,
              d.ready_at, d.assigned_at, d.picked_up_at, d.delivered_at, d.created_at, d.updated_at,
              o.tracking_code, o.delivery_code_attempts,
              v.store_name AS vendor_name, COALESCE(b.name, o.guest_name) AS buyer_name, r.name AS rider_name
       FROM deliveries d
       JOIN orders o ON o.id = d.order_id
       JOIN users v ON v.id = o.vendor_id
       LEFT JOIN users b ON b.id = o.buyer_id
       LEFT JOIN users r ON r.id = d.rider_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY FIELD(d.status, 'ready', 'returning', 'assigned') DESC, d.updated_at DESC
       LIMIT 300`,
      params
    );
    res.json(
      rows.map((r) => ({
        ...r,
        ref: orderRef({ id: r.order_id, tracking_code: r.tracking_code }),
        code_locked: r.delivery_code_attempts >= delivery.MAX_DELIVERY_CODE_ATTEMPTS,
      }))
    );
  })
);

admin.post(
  "/deliveries/:id/assign",
  requireAdminRole(...MANAGERS),
  asyncHandler(async (req, res) => {
    if (!req.body.riderId) return res.status(400).json({ error: "riderId is required." });
    await delivery.assignRider(req.params.id, req.body.riderId, { actorUserId: req.user.id, actorRole: "admin" });
    res.json({ ok: true });
  })
);

admin.post(
  "/deliveries/:id/unassign",
  requireAdminRole(...MANAGERS),
  asyncHandler(async (req, res) => {
    const ctx = await delivery.loadDeliveryContext(req.params.id);
    if (!ctx) return res.status(404).json({ error: "Delivery not found." });
    const moved = await delivery.moveDelivery(pool, ctx.id, ["assigned", "accepted"], "ready", { rider_id: null, accepted_at: null });
    if (!moved) return res.status(409).json({ error: "Only a delivery that hasn't been picked up can be unassigned." });
    await delivery.recordEvent(pool, {
      deliveryId: ctx.id,
      event: "unassigned",
      note: `Admin took the job back from ${ctx.rider_name}.`,
      actorUserId: req.user.id,
      actorRole: "admin",
    });
    await delivery.announce(ctx, { rider: { title: "Job reassigned", message: `Delivery ${orderRef({ id: ctx.order_id, tracking_code: ctx.tracking_code })} was taken off your list by VETRA dispatch.` } });
    res.json({ ok: true });
  })
);

admin.post(
  "/deliveries/:id/cancel",
  requireAdminRole(...MANAGERS),
  asyncHandler(async (req, res) => {
    const ctx = await delivery.loadDeliveryContext(req.params.id);
    if (!ctx) return res.status(404).json({ error: "Delivery not found." });
    if (!delivery.PRE_PICKUP_STATUSES.includes(ctx.status)) {
      return res.status(409).json({ error: "Only a delivery that hasn't been picked up can be cancelled. Use \"Send back to vendor\" instead." });
    }
    await delivery.cancelDeliveryForOrder(ctx.order_id, { actorUserId: req.user.id, actorRole: "admin", reason: req.body.reason });
    await delivery.syncOrderStatus(pool, ctx.order_id, "cancelled");
    await payments.refundOrder(ctx.order_id, "remaining", req.body.reason ? `Cancelled by VETRA: ${req.body.reason}` : "Cancelled by VETRA dispatch.");
    await delivery.announce(ctx, {
      buyer: {
        title: "Order cancelled",
        message: `VETRA cancelled order ${orderRef({ id: ctx.order_id, tracking_code: ctx.tracking_code })} before it was picked up. If you paid for it, you'll be refunded in full.`,
        emailIntro: "This order was cancelled by VETRA before it left the vendor. If you paid for it, the full amount is being refunded to your card; banks usually take 5 to 10 working days to show it.",
      },
      vendor: { title: "Order cancelled", message: `VETRA dispatch cancelled ${orderRef({ id: ctx.order_id, tracking_code: ctx.tracking_code })}${req.body.reason ? `: ${req.body.reason}` : "."}` },
    });
    await logActivity({
      type: "delivery",
      message: `Cancelled delivery for order <strong>${orderRef({ id: ctx.order_id, tracking_code: ctx.tracking_code })}</strong>${req.body.reason ? `: ${escapeHtml(req.body.reason)}` : "."}`,
      actorUserId: req.user.id,
      targetType: "vendor",
      targetId: ctx.vendor_id,
    });
    res.json({ ok: true });
  })
);

// Send an in-progress parcel back to the vendor, e.g. after a buyer
// calls support to cancel, or an address that can't be fixed.
admin.post(
  "/deliveries/:id/return",
  requireAdminRole(...MANAGERS),
  asyncHandler(async (req, res) => {
    const ctx = await delivery.loadDeliveryContext(req.params.id);
    if (!ctx) return res.status(404).json({ error: "Delivery not found." });
    const moved = await delivery.moveDelivery(pool, ctx.id, ["picked_up", "out_for_delivery"], "returning", {
      last_failure_reason: req.body.reason ? String(req.body.reason).slice(0, 255) : "Returned by VETRA dispatch",
    });
    if (!moved) return res.status(409).json({ error: "Only a parcel the rider is carrying can be sent back." });
    await pool.query(`UPDATE orders SET status = 'shipped' WHERE id = ? AND status = 'out_for_delivery'`, [ctx.order_id]);
    await delivery.recordEvent(pool, {
      deliveryId: ctx.id,
      event: "returning",
      note: `Dispatch sent the parcel back to the vendor${req.body.reason ? `: ${String(req.body.reason).slice(0, 300)}` : "."}`,
      publicNote: "Returning to vendor",
      actorUserId: req.user.id,
      actorRole: "admin",
    });
    await delivery.announce(ctx, {
      buyer: { title: "Delivery stopped", message: `Order ${orderRef({ id: ctx.order_id, tracking_code: ctx.tracking_code })} is going back to the vendor. You'll be refunded once it's back with them.` },
      vendor: { title: "Parcel coming back", message: `${orderRef({ id: ctx.order_id, tracking_code: ctx.tracking_code })} is being returned to you. Confirm when you receive it.` },
      rider: { title: "Return to vendor", message: `Take ${orderRef({ id: ctx.order_id, tracking_code: ctx.tracking_code })} back to ${ctx.vendor_store_name || "the vendor"}.` },
    });
    res.json({ ok: true });
  })
);

admin.post(
  "/deliveries/:id/unlock-code",
  requireAdminRole(...MANAGERS),
  asyncHandler(async (req, res) => {
    const ctx = await delivery.loadDeliveryContext(req.params.id);
    if (!ctx) return res.status(404).json({ error: "Delivery not found." });
    await pool.query(`UPDATE orders SET delivery_code_attempts = 0 WHERE id = ?`, [ctx.order_id]);
    await delivery.recordEvent(pool, {
      deliveryId: ctx.id,
      event: "code_unlocked",
      note: "Admin reset the delivery-code lock.",
      actorUserId: req.user.id,
      actorRole: "admin",
    });
    res.json({ ok: true });
  })
);

// ---- Riders ----

admin.get(
  "/riders",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.state, u.status, u.avatar_url, u.rider_vehicle, u.rider_plate,
              u.rider_on_duty, u.last_activity_at, u.created_at,
              COALESCE(SUM(d.status IN (?)), 0) AS active_jobs,
              COALESCE(SUM(d.status = 'delivered'), 0) AS delivered,
              COALESCE(SUM(d.status = 'returned'), 0) AS returned,
              COALESCE(SUM(CASE WHEN d.status IN ('delivered', 'returned') AND d.rider_paid_at IS NULL THEN d.rider_payout END), 0) AS unpaid,
              -- The part of unpaid with no automatic payout (orders from before
              -- online payments), the only part Mark paid applies to.
              COALESCE(SUM(CASE WHEN d.status IN ('delivered', 'returned') AND d.rider_paid_at IS NULL AND po.id IS NULL THEN d.rider_payout END), 0) AS manual_unpaid
       FROM users u LEFT JOIN deliveries d ON d.rider_id = u.id
       LEFT JOIN payouts po ON po.kind = 'rider' AND po.delivery_id = d.id
       WHERE u.role = 'rider' AND u.status <> 'deleted'
       GROUP BY u.id
       ORDER BY u.rider_on_duty DESC, u.name`,
      [delivery.RIDER_ACTIVE_STATUSES]
    );
    res.json(rows.map((r) => ({
      ...r,
      rider_on_duty: !!r.rider_on_duty,
      active_jobs: Number(r.active_jobs),
      delivered: Number(r.delivered),
      returned: Number(r.returned),
      unpaid: Number(r.unpaid),
    })));
  })
);

function validateRiderFields(body, { partial }) {
  if (!partial || body.name !== undefined) {
    if (!body.name || String(body.name).trim().length < 2) return "Rider name is required.";
  }
  if (!partial || body.phone !== undefined) {
    if (!body.phone || String(body.phone).trim().length < 7) return "A phone number is required, buyers and vendors call riders on it.";
  }
  if (!partial || body.state !== undefined) {
    if (!NIGERIAN_STATES.includes(body.state)) return "Choose the state this rider operates in.";
  }
  if (!partial || body.vehicle !== undefined) {
    if (!RIDER_VEHICLES.includes(body.vehicle)) return `vehicle must be one of: ${RIDER_VEHICLES.join(", ")}.`;
  }
  return null;
}

admin.post(
  "/riders",
  requireAdminRole(...MANAGERS),
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "A valid email is required." });
    const problem = validateRiderFields(req.body, { partial: false });
    if (problem) return res.status(400).json({ error: problem });

    const [existing] = await pool.query(`SELECT id FROM users WHERE email = ? AND role = 'rider'`, [email]);
    if (existing[0]) return res.status(409).json({ error: "A rider with that email already exists." });

    const id = newId();
    // Unusable random password: the rider sets their own through the
    // emailed link, so no admin ever knows a rider's password.
    const placeholderHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
    await pool.query(
      `INSERT INTO users (id, role, name, email, phone, state, password_hash, status, signup_method, rider_vehicle, rider_plate)
       VALUES (?, 'rider', ?, ?, ?, ?, ?, 'active', 'admin_invite', ?, ?)`,
      [id, String(req.body.name).trim(), email, String(req.body.phone).trim(), req.body.state, placeholderHash,
        req.body.vehicle, req.body.plate ? String(req.body.plate).trim().toUpperCase().slice(0, 40) : null]
    );
    await createAndEmailPasswordReset(
      { id, name: req.body.name, email },
      {
        expiresInHours: 72,
        subject: "You've been added as a VETRA rider",
        introHtml: "VETRA dispatch created a rider account for you. Set your password below, then sign in at the rider app (/rider/login.html) to start receiving delivery jobs.",
      }
    );
    await logActivity({
      type: "delivery",
      message: `Added rider <strong>${escapeHtml(String(req.body.name).trim())}</strong> (${escapeHtml(req.body.state)}).`,
      actorUserId: req.user.id,
      targetType: "rider",
      targetId: id,
    });
    res.status(201).json({ id });
  })
);

admin.patch(
  "/riders/:id",
  requireAdminRole(...MANAGERS),
  asyncHandler(async (req, res) => {
    const [[existing]] = await pool.query(`SELECT id, name, status FROM users WHERE id = ? AND role = 'rider'`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: "Rider not found." });
    const problem = validateRiderFields(req.body, { partial: true });
    if (problem) return res.status(400).json({ error: problem });
    if (req.body.status !== undefined && !["active", "suspended"].includes(req.body.status)) {
      return res.status(400).json({ error: "status must be 'active' or 'suspended'." });
    }

    const fieldMap = { name: "name", phone: "phone", state: "state", vehicle: "rider_vehicle", plate: "rider_plate", status: "status" };
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(fieldMap)) {
      if (req.body[key] === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(key === "name" ? String(req.body.name).trim() : req.body[key]);
    }
    if (req.body.status === "suspended") {
      sets.push("rider_on_duty = FALSE", "session_version = session_version + 1");
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update." });
    params.push(req.params.id);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);

    // A suspended rider's not-yet-collected jobs go back to the queue.
    // Anything already picked up stays with them for dispatch to sort
    // out by phone, since the parcel is physically in their hands.
    if (req.body.status === "suspended") {
      const [jobs] = await pool.query(`SELECT id FROM deliveries WHERE rider_id = ? AND status IN ('assigned', 'accepted')`, [req.params.id]);
      for (const job of jobs) {
        if (await delivery.moveDelivery(pool, job.id, ["assigned", "accepted"], "ready", { rider_id: null, accepted_at: null })) {
          await delivery.recordEvent(pool, { deliveryId: job.id, event: "unassigned", note: "Rider suspended, job returned to the queue.", actorUserId: req.user.id, actorRole: "admin" });
          await delivery.tryAutoAssign(job.id);
        }
      }
    }
    if (req.body.status && req.body.status !== existing.status) {
      await logActivity({
        type: "delivery",
        message: `${req.body.status === "suspended" ? "Suspended" : "Reactivated"} rider <strong>${escapeHtml(existing.name)}</strong>.`,
        actorUserId: req.user.id,
        targetType: "rider",
        targetId: req.params.id,
      });
    }
    res.json({ ok: true });
  })
);

admin.post(
  "/riders/:id/resend-invite",
  requireAdminRole(...MANAGERS),
  asyncHandler(async (req, res) => {
    const [[r]] = await pool.query(`SELECT id, name, email FROM users WHERE id = ? AND role = 'rider' AND status = 'active'`, [req.params.id]);
    if (!r) return res.status(404).json({ error: "Rider not found." });
    await createAndEmailPasswordReset(r, {
      expiresInHours: 72,
      subject: "Set your VETRA rider password",
      introHtml: "Here's a fresh link to set your VETRA rider password.",
    });
    res.json({ ok: true });
  })
);

// Records that VETRA has paid a rider, outside the app, for jobs that have
// no automatic Paystack payout: jobs on orders placed before payments
// existed. Jobs on paid orders are paid by utils/payments.js and never
// counted here, so nobody can mark a job paid that Paystack is also paying.
const MANUAL_PAYOUT_FILTER = `rider_id = ? AND status IN ('delivered', 'returned') AND rider_paid_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM payouts p WHERE p.kind = 'rider' AND p.delivery_id = deliveries.id)`;
admin.post(
  "/riders/:id/payouts",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const [[r]] = await pool.query(`SELECT id, name FROM users WHERE id = ? AND role = 'rider'`, [req.params.id]);
    if (!r) return res.status(404).json({ error: "Rider not found." });
    const [[{ amount, jobs }]] = await pool.query(
      `SELECT COALESCE(SUM(rider_payout), 0) AS amount, COUNT(*) AS jobs FROM deliveries WHERE ${MANUAL_PAYOUT_FILTER}`,
      [r.id]
    );
    if (!Number(jobs)) return res.status(400).json({ error: "Nothing to mark paid by hand: this rider's other jobs are paid automatically." });
    await pool.query(
      `UPDATE deliveries SET rider_paid_at = NOW() WHERE ${MANUAL_PAYOUT_FILTER}`,
      [r.id]
    );
    await logActivity({
      type: "delivery",
      message: `Marked ₦${(Number(amount) / 100).toLocaleString("en-NG")} paid to rider <strong>${escapeHtml(r.name)}</strong> for ${jobs} job${Number(jobs) === 1 ? "" : "s"}.`,
      actorUserId: req.user.id,
      targetType: "rider",
      targetId: r.id,
    });
    res.json({ ok: true, amount: Number(amount), jobs: Number(jobs) });
  })
);

// ---- Rates & settings ----

admin.get(
  "/rates",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM delivery_rates ORDER BY state`);
    res.json(rows.map((r) => ({ ...r, active: !!r.active })));
  })
);

admin.put(
  "/rates/:state",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const state = req.params.state;
    if (!NIGERIAN_STATES.includes(state)) return res.status(400).json({ error: "Unknown state." });
    const { intraStateFee, interStateFee, etaDaysMin, etaDaysMax, active } = req.body;
    const fees = [intraStateFee, interStateFee];
    if (fees.some((f) => !Number.isInteger(f) || f < 0 || f > 100000000)) {
      return res.status(400).json({ error: "Fees must be whole kobo amounts between 0 and ₦1,000,000." });
    }
    if (!Number.isInteger(etaDaysMin) || !Number.isInteger(etaDaysMax) || etaDaysMin < 0 || etaDaysMax < etaDaysMin || etaDaysMax > 30) {
      return res.status(400).json({ error: "Delivery window must be 0–30 days, with the minimum no greater than the maximum." });
    }
    await pool.query(
      `INSERT INTO delivery_rates (state, intra_state_fee, inter_state_fee, eta_days_min, eta_days_max, active)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE intra_state_fee = VALUES(intra_state_fee), inter_state_fee = VALUES(inter_state_fee),
         eta_days_min = VALUES(eta_days_min), eta_days_max = VALUES(eta_days_max), active = VALUES(active)`,
      [state, intraStateFee, interStateFee, etaDaysMin, etaDaysMax, active !== false]
    );
    await logActivity({
      type: "delivery",
      message: `Updated delivery rates for <strong>${escapeHtml(state)}</strong>.`,
      actorUserId: req.user.id,
    });
    res.json({ ok: true });
  })
);

admin.patch(
  "/settings",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const rules = {
      freeDeliveryThreshold: { column: "free_delivery_threshold", min: 0, max: 100000000 },
      riderPayoutPercent: { column: "rider_payout_percent", min: 0, max: 100 },
      autoConfirmHours: { column: "auto_confirm_hours", min: 1, max: 720 },
      maxDeliveryAttempts: { column: "max_delivery_attempts", min: 1, max: 10 },
    };
    const sets = [];
    const params = [];
    for (const [key, rule] of Object.entries(rules)) {
      if (req.body[key] === undefined) continue;
      const v = req.body[key];
      if (!Number.isInteger(v) || v < rule.min || v > rule.max) {
        return res.status(400).json({ error: `${key} must be a whole number between ${rule.min} and ${rule.max}.` });
      }
      sets.push(`${rule.column} = ?`);
      params.push(v);
    }
    if (req.body.autoAssignRiders !== undefined) {
      if (typeof req.body.autoAssignRiders !== "boolean") return res.status(400).json({ error: "autoAssignRiders must be a boolean." });
      sets.push("auto_assign_riders = ?");
      params.push(req.body.autoAssignRiders);
    }
    if (!sets.length) return res.status(400).json({ error: "No settings to update." });
    await pool.query(`UPDATE platform_settings SET ${sets.join(", ")} WHERE id = 1`, params);
    await logActivity({ type: "delivery", message: "Updated delivery settings.", actorUserId: req.user.id });
    res.json(await delivery.getDeliverySettings());
  })
);

router.use("/admin", admin);

module.exports = router;
