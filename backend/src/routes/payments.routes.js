/* =========================================================
   /api/payments: buyer checkout through Flutterwave, the return page's
   status check, and Flutterwave's webhook. The money logic itself lives
   in utils/payments.js.

   The webhook is exported separately because it must be mounted in
   app.js before express.json(): Flutterwave's flutterwave-signature is
   computed over the raw request body, which JSON parsing would discard.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const payments = require("../utils/payments");
const { verifyWebhookSignature } = require("../utils/flutterwave");

const router = express.Router();

router.post(
  "/checkout",
  requireAuth,
  requireRole("buyer"),
  asyncHandler(async (req, res) => {
    const result = await payments.startCheckout(req.user, req.body);
    res.status(201).json(result);
  })
);

// Public: the commission rate VETRA currently deducts from vendor sales
// (admin Settings > Payments). Shown on commission-and-fees.html and in
// the vendor's Add Product form, the fees policy promises vendors see
// the rate before they sell. Registered before /:reference, which would
// otherwise swallow this path and demand a buyer token.
router.get(
  "/commission",
  asyncHandler(async (req, res) => {
    const { commissionPercent } = await payments.getPaymentSettings();
    res.set("Cache-Control", "public, max-age=300");
    res.json({ commissionPercent });
  })
);

// Polled by customer/orders.html after Flutterwave redirects the buyer back.
// Finalizes on the spot if the webhook hasn't arrived yet.
router.get(
  "/:reference",
  requireAuth,
  requireRole("buyer"),
  asyncHandler(async (req, res) => {
    const [[payment]] = await pool.query(
      `SELECT id, reference, status, amount, processing_fee FROM payments WHERE reference = ? AND buyer_id = ?`,
      [req.params.reference, req.user.id]
    );
    if (!payment) return res.status(404).json({ error: "Payment not found." });
    let status = payment.status;
    if (status === "initialized") status = await payments.finalizePayment(payment.reference);
    const [orders] = await pool.query(
      `SELECT id, tracking_code FROM orders WHERE payment_id = ? ORDER BY created_at`,
      [payment.id]
    );
    const [[refund]] = await pool.query(
      `SELECT COUNT(*) AS count, MAX(reason) AS reason FROM refunds WHERE payment_id = ? AND order_id IS NULL`,
      [payment.id]
    );
    // Read after finalizePayment(), which is what records the channel.
    const [[{ channel }]] = await pool.query(`SELECT channel FROM payments WHERE id = ?`, [payment.id]);
    res.json({
      reference: payment.reference,
      status,
      amount: payment.amount,
      processingFee: payment.processing_fee,
      orders: orders.map((o) => ({ id: o.id, trackingCode: o.tracking_code })),
      refunded: Number(refund.count) > 0,
      refundReason: refund.reason || null,
      channel: channel || null,
    });
  })
);

// Flutterwave webhook (Dashboard > Settings > Webhooks: URL
// https://<api host>/api/payments/webhook, secret hash = FLW_WEBHOOK_HASH).
// Mounted in app.js with express.raw(), so req.body is the raw Buffer.
// Every handler re-checks with Flutterwave before recording anything, so
// the body itself is never trusted for amounts or statuses.
const webhook = asyncHandler(async (req, res) => {
  if (!verifyWebhookSignature(req.body, req.headers)) {
    return res.status(401).json({ error: "Invalid signature." });
  }
  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON." });
  }
  // Flutterwave retries anything that isn't a quick 2xx, and every handler
  // below is idempotent, so a failure here is logged and left to the
  // retry (or the sweep) rather than turned into a 500 loop.
  const name = String(event?.event || event?.type || "");
  const data = event?.data || {};
  try {
    if (name === "charge.completed" && data.tx_ref) {
      await payments.finalizePayment(data.tx_ref);
    } else if (name === "transfer.completed") {
      await payments.handleTransferEvent(data);
    } else if (name.startsWith("refund")) {
      await payments.handleRefundEvent(data);
    }
  } catch (err) {
    // A charge for a reference VETRA never made (another app on the same
    // Flutterwave account) lands here as "Payment not found." and is ignored.
    console.error(`[payments] webhook ${name} failed:`, err.message);
  }
  res.sendStatus(200);
});

module.exports = router;
module.exports.webhook = webhook;
