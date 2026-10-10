/* =========================================================
   /api/payments: buyer checkout through Paystack, the return page's
   status check, and Paystack's webhook. The money logic itself lives in
   utils/payments.js.

   The webhook is exported separately because it must be mounted in
   app.js before express.json(): Paystack's signature is computed over
   the raw request body, which JSON parsing would discard.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const payments = require("../utils/payments");
const { verifyWebhookSignature } = require("../utils/paystack");

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

// Polled by customer/orders.html after Paystack redirects the buyer back.
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
      `SELECT COUNT(*) AS count FROM refunds WHERE payment_id = ? AND order_id IS NULL`,
      [payment.id]
    );
    res.json({
      reference: payment.reference,
      status,
      amount: payment.amount,
      processingFee: payment.processing_fee,
      orders: orders.map((o) => ({ id: o.id, trackingCode: o.tracking_code })),
      refunded: Number(refund.count) > 0,
    });
  })
);

// Paystack webhook. Mounted in app.js with express.raw(), so req.body is
// the raw Buffer the signature was computed over.
const webhook = asyncHandler(async (req, res) => {
  if (!verifyWebhookSignature(req.body, req.get("x-paystack-signature"))) {
    return res.status(401).json({ error: "Invalid signature." });
  }
  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON." });
  }
  // Paystack retries anything that isn't a quick 2xx, and every handler
  // below is idempotent, so a failure here is logged and left to the
  // retry (or the sweep) rather than turned into a 500 loop.
  try {
    const { event: name, data } = event;
    if (name === "charge.success" && data?.reference) {
      await payments.finalizePayment(data.reference);
    } else if (["transfer.success", "transfer.failed", "transfer.reversed"].includes(name)) {
      await payments.handleTransferEvent(name, data);
    } else if (["refund.processed", "refund.failed"].includes(name)) {
      await payments.handleRefundEvent(name, data);
    }
  } catch (err) {
    console.error(`[payments] webhook ${event?.event} failed:`, err.message);
  }
  res.sendStatus(200);
});

module.exports = router;
module.exports.webhook = webhook;
