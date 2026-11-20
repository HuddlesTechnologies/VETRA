/* =========================================================
   Money: Flutterwave checkout, automatic payouts, refunds.

   Checkout (startCheckout) never creates an order. It prices the cart,
   reserves the stock, stores the whole cart as a `payments` row and
   hands the buyer Flutterwave's checkout link. Only when Flutterwave confirms
   the charge does finalizePayment() create the real orders and delivery
   rows, so `orders` never holds an unpaid order. Webhook and the buyer's
   return page both call finalizePayment(); a guarded UPDATE inside one
   transaction makes sure only one of them creates the orders.

   Money out goes through `payouts` (Flutterwave Transfers from the NGN balance):
   - a rider, the moment their delivery is completed with the buyer's
     code (or the parcel is returned to the vendor);
   - a vendor, when escrow releases (buyer confirms, or the protection
     window passes): goods total minus commission, plus the delivery fee
     if the vendor shipped it themselves.
   Nothing is sent while platform_settings.auto_payouts_enabled is off:
   payouts wait as 'queued' until a Super Admin turns it on.

   Money back goes through `refunds` (Flutterwave Refunds to the card or
   bank account the buyer paid with). Flutterwave's refund call takes no
   idempotency key, so a refund is never retried automatically: a timeout
   is recorded as failed for a Super Admin to check in the Flutterwave
   dashboard before retrying.

   VETRA used Paystack until November 2026 and no longer talks to it
   (migration 028). Rows from then have provider = 'paystack': their
   refunds are made by hand in the Paystack dashboard, and a payout
   attempted through Paystack is only resent through Flutterwave when a
   Super Admin retries it.

   Orders placed before payments existed have payment_id NULL. No money
   was collected for them, so they never pay out or refund here.
   ========================================================= */

const crypto = require("crypto");
const pool = require("../db");
const { newId, newTrackingCode, orderRef } = require("./id");
const { logActivity } = require("./activityLog");
const { notify } = require("./notify");
const { sendEmail } = require("./mailer");
const { escapeHtml } = require("./escapeHtml");
const { nairaLabel, refundDestination, buildOrderEmailHtml } = require("./orderEmail");
const { alertIfLowStock } = require("./lowStockAlert");
const { NIGERIAN_STATES } = require("./nigerianStates");
const { decrypt } = require("./encryption");
const flutterwave = require("./flutterwave");
const delivery = require("./delivery");
const { findBannedIdentifier, recordIdentifier } = require("./identifiers");

const FRONTEND_URL = process.env.FRONTEND_URL || "https://vetrahq.org";

// How long a checkout holds its reserved stock before the sweep gives it
// back (expireAbandonedCheckouts).
const CHECKOUT_TTL_MINUTES = 30;
// Failed payouts are retried by the sweep up to this many attempts, at
// most once per RETRY_INTERVAL_MINUTES.
const MAX_PAYOUT_ATTEMPTS = 5;
const RETRY_INTERVAL_MINUTES = 30;

// Flutterwave's Nigerian local pricing (flutterwave.com/ng/pricing,
// November 2026): 2% per transaction (1.4% + 0.6% platform fee), plus
// 7.5% VAT on the fee. Check the pricing page before changing.
const FEE_PERCENT = 0.02 * 1.075;

class PaymentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Roughly the fee the buyer pays on top of `net` (kobo). Flutterwave adds
 * this itself while customers bear the fees (the default, Dashboard >
 * Settings), so startCheckout() doesn't; api-client.js's copy shows the
 * buyer what to expect in the cart.
 */
function processingFee(net) {
  if (net <= 0) return 0;
  return Math.ceil(net * FEE_PERCENT);
}

function newReference(prefix) {
  // Safe for Flutterwave's tx_ref and transfer reference: letters, digits, - and _.
  return `vetra-${prefix}-${crypto.randomUUID().replace(/-/g, "")}`;
}

function parseJson(value) {
  // MySQL returns a JSON column parsed; MariaDB returns the text.
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function getPaymentSettings(db = pool) {
  const [[row]] = await db.query(
    `SELECT commission_percent, auto_payouts_enabled, maintenance_mode FROM platform_settings WHERE id = 1`
  );
  return {
    commissionPercent: Number(row?.commission_percent || 0),
    autoPayoutsEnabled: Boolean(row?.auto_payouts_enabled),
    maintenanceMode: Boolean(row?.maintenance_mode),
  };
}

// ---------- Checkout ----------

function readDeliveryDetails(body, buyer) {
  const method = body.deliveryMethod || "delivery";
  if (!["delivery", "pickup"].includes(method)) throw new PaymentError("deliveryMethod must be 'delivery' or 'pickup'.");
  const details = {
    method,
    address: String(body.deliveryAddress || buyer.address || "").trim().slice(0, 255) || null,
    state: body.deliveryState || buyer.state || null,
    phone: String(body.deliveryPhone || buyer.phone || "").trim().slice(0, 40) || null,
    notes: String(body.deliveryNotes || "").trim().slice(0, 255) || null,
  };
  if (method === "delivery") {
    if (!details.address) throw new PaymentError("Enter a delivery address.");
    if (!NIGERIAN_STATES.includes(details.state)) throw new PaymentError("Choose the state you're delivering to.");
    if (!details.phone) throw new PaymentError("Enter a phone number the rider can reach you on.");
  } else {
    details.address = null;
    details.state = null;
  }
  return details;
}

/** Validates and prices one store's share of the cart, the rules POST /api/orders used to apply. */
async function priceGroup(group, details) {
  const { vendorId, items } = group || {};
  if (!vendorId || !Array.isArray(items) || !items.length) {
    throw new PaymentError("Each store in the cart needs at least one item.");
  }
  const productIds = items.map((item) => item?.productId);
  if (productIds.some((id) => !id) || new Set(productIds).size !== productIds.length) {
    throw new PaymentError("Each product may appear only once in an order.");
  }
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
      throw new PaymentError("Each item quantity must be a whole number between 1 and 1000.");
    }
  }
  const [products] = await pool.query(
    `SELECT p.id, p.name, p.price, p.stock_quantity
     FROM products p JOIN users v ON v.id = p.vendor_id
     WHERE p.id IN (?) AND p.vendor_id = ? AND p.status = 'active' AND v.status = 'active'`,
    [productIds, vendorId]
  );
  if (products.length !== productIds.length) throw new PaymentError("One or more items are no longer available.");
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  for (const item of items) {
    if (item.quantity > byId[item.productId].stock_quantity) {
      throw new PaymentError(`Not enough stock for "${byId[item.productId].name}".`);
    }
  }
  const pricedItems = items.map((item) => ({
    productId: item.productId,
    name: byId[item.productId].name,
    price: byId[item.productId].price,
    quantity: item.quantity,
  }));
  const goodsTotal = pricedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // The fee is recomputed from the rate table, never taken from the client.
  let quote = null;
  if (details.method === "delivery") {
    quote = await delivery.quoteDelivery({ vendorId, state: details.state, subtotal: goodsTotal });
    if (!quote.deliverable) throw new PaymentError(`One of the stores in your cart doesn't deliver to ${details.state} yet. Choose pickup instead.`);
  }
  return {
    vendorId,
    items: pricedItems,
    goodsTotal,
    deliveryFee: quote ? quote.fee : 0,
    quote: quote ? { fee: quote.fee, riderPayout: quote.riderPayout } : null,
  };
}

async function reserveStock(conn, groups) {
  for (const group of groups) {
    for (const item of group.items) {
      const [result] = await conn.query(
        `UPDATE products
         SET stock_quantity = stock_quantity - ?,
             status = IF(stock_quantity - ? <= 0, 'out_of_stock', status)
         WHERE id = ? AND status = 'active' AND stock_quantity >= ?`,
        [item.quantity, item.quantity, item.productId, item.quantity]
      );
      if (result.affectedRows !== 1) {
        throw new PaymentError(`"${item.name}" is no longer available in that quantity.`);
      }
    }
  }
}

async function releaseStock(conn, groups) {
  for (const group of groups) {
    for (const item of group.items) {
      // A listing the vendor removed meanwhile stays removed; one that hit
      // zero because of this reservation becomes sellable again.
      await conn.query(
        `UPDATE products SET stock_quantity = stock_quantity + ?,
           status = IF(status = 'out_of_stock', 'active', status)
         WHERE id = ?`,
        [item.quantity, item.productId]
      );
    }
  }
}

/**
 * POST /api/payments/checkout. Returns { reference, authorizationUrl }
 * for the browser to redirect to, or { reference, alreadyPaid: true }
 * when this checkout attempt was already paid for.
 */
async function startCheckout(user, body) {
  const settings = await getPaymentSettings();
  if (settings.maintenanceMode) {
    throw new PaymentError("VETRA is undergoing maintenance right now, please try checking out again shortly.", 503);
  }
  const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey).slice(0, 128) : null;
  if (idempotencyKey) {
    const [[existing]] = await pool.query(
      `SELECT reference, status, authorization_url, expires_at > NOW() AS still_open
       FROM payments WHERE idempotency_key = ? AND buyer_id = ?`,
      [idempotencyKey, user.id]
    );
    if (existing?.status === "success") return { reference: existing.reference, alreadyPaid: true };
    // Compared in SQL: expires_at is written with the database's NOW(), and
    // the database and this server don't always share a timezone.
    if (existing?.status === "initialized" && existing.authorization_url && Number(existing.still_open)) {
      return { reference: existing.reference, authorizationUrl: existing.authorization_url };
    }
    if (existing) throw new PaymentError("This checkout expired. Refresh the cart and try again.", 409);
  }

  const [[buyer]] = await pool.query(`SELECT id, name, email, phone, address, state FROM users WHERE id = ?`, [user.id]);
  const details = readDeliveryDetails(body, buyer);
  if (!Array.isArray(body.groups) || !body.groups.length) throw new PaymentError("Your cart is empty.");
  if (body.groups.length > 20) throw new PaymentError("Too many stores in one checkout.");
  const vendorIds = body.groups.map((g) => g?.vendorId);
  if (new Set(vendorIds).size !== vendorIds.length) throw new PaymentError("Each store may appear only once in a checkout.");

  const groups = [];
  for (const group of body.groups) groups.push(await priceGroup(group, details));
  const goodsTotal = groups.reduce((sum, g) => sum + g.goodsTotal, 0);
  const deliveryTotal = groups.reduce((sum, g) => sum + g.deliveryFee, 0);
  // Flutterwave's customers bear its fees by default: it adds the fee on
  // top of `amount` at its checkout and VETRA receives `amount` in full.
  // Adding processingFee() here as well would charge buyers the fee twice.
  // processing_fee is filled in with what Flutterwave actually charged
  // once the payment succeeds. If fees are ever switched to the merchant
  // in the dashboard, add processingFee() here.
  const fee = 0;
  const amount = goodsTotal + deliveryTotal;

  const paymentId = newId();
  const reference = newReference("pay");
  const snapshot = {
    buyer: { id: buyer.id, name: buyer.name, email: buyer.email },
    delivery: details,
    commissionPercent: settings.commissionPercent,
    groups,
  };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await reserveStock(conn, groups);
    await conn.query(
      `INSERT INTO payments (id, reference, buyer_id, email, goods_total, delivery_total, processing_fee, amount,
                             cart_snapshot, idempotency_key, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL ? MINUTE)`,
      [paymentId, reference, buyer.id, buyer.email, goodsTotal, deliveryTotal, fee, amount,
        JSON.stringify(snapshot), idempotencyKey, CHECKOUT_TTL_MINUTES]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  let init;
  try {
    init = await flutterwave.initializeTransaction({
      email: buyer.email,
      name: buyer.name,
      phone: buyer.phone,
      amount,
      reference,
      callbackUrl: `${FRONTEND_URL}/customer/orders.html?payment=${reference}`,
      metadata: { paymentId, stores: groups.length },
    });
  } catch (err) {
    // Nothing was charged: give the stock back straight away instead of
    // making it wait out the checkout window.
    const [result] = await pool.query(`UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'initialized'`, [paymentId]);
    if (result.affectedRows === 1) await releaseStock(pool, groups);
    throw err;
  }
  await pool.query(`UPDATE payments SET authorization_url = ? WHERE id = ?`, [init.authorizationUrl, paymentId]);
  return { reference, authorizationUrl: init.authorizationUrl };
}

// ---------- Finalizing a paid checkout ----------

async function createOrderFromGroup(conn, { paymentId, buyer, details, group, commissionPercent }) {
  const orderId = newId();
  const trackingCode = newTrackingCode();
  const deliveryCode = delivery.newDeliveryCode();
  await conn.query(
    `INSERT INTO orders (id, tracking_code, buyer_id, vendor_id, delivery_method, delivery_address, delivery_state,
                         delivery_phone, delivery_notes, delivery_code, total, delivery_fee, payment_id, commission_percent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderId, trackingCode, buyer.id, group.vendorId, details.method, details.address, details.state,
      details.phone, details.notes, deliveryCode, group.goodsTotal, group.deliveryFee, paymentId, commissionPercent]
  );
  for (const item of group.items) {
    await conn.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase) VALUES (?, ?, ?, ?, ?)`,
      [newId(), orderId, item.productId, item.quantity, item.price]
    );
  }
  if (details.method === "delivery") {
    const [[vendor]] = await conn.query(`SELECT address, state, phone FROM users WHERE id = ?`, [group.vendorId]);
    await delivery.createDeliveryForOrder(conn, {
      orderId,
      vendor: vendor || {},
      dropoffAddress: details.address,
      dropoffState: details.state,
      dropoffPhone: details.phone,
      recipientName: buyer.name,
      quote: group.quote,
    });
  }
  return { orderId, trackingCode, deliveryCode };
}

/** Everything a new order used to trigger at checkout: alerts, activity, notifications, emails. */
async function announceNewOrder({ order, group, buyer, details }) {
  const ref = order.trackingCode;
  const productIds = group.items.map((i) => i.productId);
  const [lowStockProducts] = await pool.query(
    `SELECT p.id, p.name, p.stock_quantity, u.id AS vendor_id, u.email AS vendor_email
     FROM products p JOIN users u ON u.id = p.vendor_id WHERE p.id IN (?)`,
    [productIds]
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
  const itemCount = `${group.items.length} item${group.items.length > 1 ? "s" : ""}`;
  await logActivity({
    type: "order",
    message: `Order <strong>${ref}</strong> placed and paid.`,
    actorUserId: buyer.id,
    targetType: "vendor",
    targetId: group.vendorId,
  });
  await notify({
    userId: group.vendorId,
    type: "order",
    title: "New order received",
    message: `Order ${ref}, ${nairaLabel(group.goodsTotal)} across ${itemCount}, paid.`,
    link: "orders.html",
  });

  const emailItems = group.items.map((i) => ({ name: i.name, quantity: i.quantity, priceAtPurchase: i.price }));
  const [[vendorRow]] = await pool.query(`SELECT name, email, store_name FROM users WHERE id = ?`, [group.vendorId]);
  if (vendorRow) {
    await sendEmail({
      to: vendorRow.email,
      subject: `New order ${ref}`,
      html: buildOrderEmailHtml({
        greetingName: vendorRow.name,
        introHtml: `You've got a new paid order, <strong>${ref}</strong>, ${nairaLabel(group.goodsTotal)} across ${itemCount}. Review and update it from your Orders page.`,
        ref, trackingCode: order.trackingCode, vendorStoreName: vendorRow.store_name,
        items: emailItems, deliveryMethod: details.method, deliveryAddress: details.address, total: group.goodsTotal,
      }),
      logFallback: `new order notice for vendor ${vendorRow.email}: ${ref}`,
    });
  }
  if (buyer.email) {
    await sendEmail({
      to: buyer.email,
      subject: `Your VETRA order ${ref} is confirmed`,
      html: buildOrderEmailHtml({
        greetingName: buyer.name || "there",
        introHtml: details.method === "pickup"
          ? "Thanks, your payment went through. We'll email you once the vendor has it ready, then collect it from their store and give them your pickup code."
          : "Thanks, your payment went through. We'll email you as your order moves toward delivery, and you can follow it live from your Orders page.",
        ref, trackingCode: order.trackingCode, vendorStoreName: vendorRow?.store_name,
        items: emailItems, deliveryMethod: details.method, deliveryAddress: details.address,
        total: group.goodsTotal, deliveryFee: group.deliveryFee, deliveryCode: order.deliveryCode,
      }),
      logFallback: `order confirmation for ${buyer.email}: ${ref}`,
    });
  }
}

// Statuses for a charge that is still under way (bank transfer, USSD and
// similar channels settle minutes after the buyer leaves the page).
const IN_PROGRESS_STATUSES = ["ongoing", "pending", "processing", "queued"];
// How long past expires_at the sweep keeps holding stock for one of those.
const IN_PROGRESS_GRACE_MINUTES = 120;

/**
 * Confirms a payment with Flutterwave and, the first time it is seen paid,
 * creates its orders. Safe to call any number of times, concurrently.
 * Resolves to the payment's status afterwards.
 */
async function finalizePayment(reference) {
  return (await checkAndFinalizePayment(reference)).status;
}

/** finalizePayment, also returning Flutterwave's own status for the charge. */
async function checkAndFinalizePayment(reference) {
  const [[payment]] = await pool.query(`SELECT * FROM payments WHERE reference = ?`, [reference]);
  if (!payment) throw new PaymentError("Payment not found.", 404);
  if (payment.status === "success") return { status: "success" };
  // A checkout opened on Paystack before the switch can't be checked any
  // more; the sweep lets it expire like any unpaid checkout.
  if (payment.provider === "paystack") return { status: payment.status };

  let verified;
  try {
    verified = await flutterwave.verifyTransaction(reference);
  } catch (err) {
    // Flutterwave has no record yet: the buyer never reached the pay step.
    if (err.providerStatus === 400 || err.providerStatus === 404) return { status: payment.status };
    throw err;
  }
  if (verified.status !== "success") return { status: payment.status, providerStatus: verified.status };

  // The charged amount includes Flutterwave's fee while customers bear
  // it, so what VETRA asked for is `requestedAmount`. Comparing only
  // `amount` would refund every such payment as a mismatch.
  const expected = Number(payment.amount);
  const amountMatches = Number(verified.requestedAmount) === expected || Number(verified.amount) === expected;
  if (verified.currency !== "NGN" || !amountMatches) {
    // Never fulfil a charge that doesn't match what VETRA asked for.
    console.error(`[payments] ${reference}: Flutterwave charged ${verified.currency} ${verified.amount} (requested ${verified.requestedAmount}), expected NGN ${payment.amount}`);
    const [claimed] = await pool.query(
      `UPDATE payments SET status = 'failed', provider_transaction_id = ?, channel = ? WHERE id = ? AND status IN ('initialized', 'abandoned')`,
      [verified.id, verified.channel || null, payment.id]
    );
    if (claimed.affectedRows === 1) {
      if (payment.status === "initialized") await releaseStock(pool, parseJson(payment.cart_snapshot).groups);
      await refundUnfulfilledPayment(payment, Number(verified.amount), "Charged amount didn't match the checkout.", verified.channel);
    }
    return { status: "failed" };
  }

  // A card belonging to a banned person: no order, money back in full.
  if (verified.cardSignature && await findBannedIdentifier([["card", verified.cardSignature]])) {
    const [claimed] = await pool.query(
      `UPDATE payments SET status = 'failed', paid_at = NOW(), provider_transaction_id = ?, channel = ?, card_signature = ?
       WHERE id = ? AND status IN ('initialized', 'abandoned')`,
      [verified.id, verified.channel || null, verified.cardSignature, payment.id]
    );
    if (claimed.affectedRows === 1) {
      await recordIdentifier(payment.buyer_id, "card", verified.cardSignature);
      if (payment.status === "initialized") await releaseStock(pool, parseJson(payment.cart_snapshot).groups);
      await refundUnfulfilledPayment(payment, Number(verified.amount), "This card can't be used on VETRA.", verified.channel);
      await logActivity({
        type: "ban",
        message: `Refused a payment made with a banned card (${escapeHtml(reference)}), refunded.`,
        targetType: "customer",
        targetId: payment.buyer_id,
      });
    }
    return { status: "failed" };
  }

  const snapshot = parseJson(payment.cart_snapshot);
  const created = [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // The claim and the order inserts commit together, so a crash can
    // never leave a payment marked paid with no orders, and a second
    // caller blocks on this row until the first has finished.
    const [claim] = await conn.query(
      `UPDATE payments SET status = 'success', paid_at = NOW(), provider_transaction_id = ?, channel = ?,
         processing_fee = GREATEST(? - amount, 0), card_signature = ?
       WHERE id = ? AND status = 'initialized'`,
      [verified.id, verified.channel, Number(verified.amount) || 0, verified.cardSignature, payment.id]
    );
    if (claim.affectedRows === 1) {
      for (const group of snapshot.groups) {
        const order = await createOrderFromGroup(conn, {
          paymentId: payment.id,
          buyer: snapshot.buyer,
          details: snapshot.delivery,
          group,
          commissionPercent: snapshot.commissionPercent,
        });
        created.push({ order, group });
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  if (!created.length) {
    // The claim lost. Either another call already created the orders, or
    // this payment had expired (its stock released) before the buyer paid.
    const [[now]] = await pool.query(`SELECT status FROM payments WHERE id = ?`, [payment.id]);
    if (now.status !== "abandoned") return { status: now.status };
    const late = await fulfilLatePayment(payment, verified, snapshot);
    if (!late) return { status: "failed" };
    created.push(...late);
  }

  await recordIdentifier(payment.buyer_id, "card", verified.cardSignature);
  for (const { order, group } of created) {
    await announceNewOrder({ order, group, buyer: snapshot.buyer, details: snapshot.delivery });
  }
  return { status: "success" };
}

/**
 * A payment that landed after its checkout expired. The stock it held was
 * given back, so it is reserved again: if everything is still in stock the
 * orders go ahead as normal, and only if not is the buyer refunded.
 */
async function fulfilLatePayment(payment, verified, snapshot) {
  const created = [];
  const conn = await pool.getConnection();
  let claimed = false;
  try {
    await conn.beginTransaction();
    const [claim] = await conn.query(
      `UPDATE payments SET status = 'success', paid_at = NOW(), provider_transaction_id = ?, channel = ?,
         processing_fee = GREATEST(? - amount, 0), card_signature = ?
       WHERE id = ? AND status = 'abandoned'`,
      [verified.id, verified.channel, Number(verified.amount) || 0, verified.cardSignature, payment.id]
    );
    claimed = claim.affectedRows === 1;
    if (claimed) {
      await reserveStock(conn, snapshot.groups);
      for (const group of snapshot.groups) {
        const order = await createOrderFromGroup(conn, {
          paymentId: payment.id,
          buyer: snapshot.buyer,
          details: snapshot.delivery,
          group,
          commissionPercent: snapshot.commissionPercent,
        });
        created.push({ order, group });
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (!(err instanceof PaymentError)) throw err;
    // Something sold out meanwhile: refund instead.
    const [late] = await pool.query(
      `UPDATE payments SET status = 'failed', paid_at = NOW(), provider_transaction_id = ?, channel = ? WHERE id = ? AND status = 'abandoned'`,
      [verified.id, verified.channel || null, payment.id]
    );
    if (late.affectedRows === 1) {
      await refundUnfulfilledPayment(payment, payment.amount, "Paid after the checkout had expired, and some items had sold out by then.", verified.channel);
    }
    return null;
  } finally {
    conn.release();
  }
  return claimed ? created : null;
}

/** Full refund of a payment that never became orders (late or mismatched). */
async function refundUnfulfilledPayment(payment, amount, reason, channel) {
  const refundId = newId();
  await pool.query(
    `INSERT INTO refunds (id, order_id, payment_id, amount, reason) VALUES (?, NULL, ?, ?, ?)`,
    [refundId, payment.id, amount, reason]
  );
  await sendRefund(refundId, amount);
  await sendEmail({
    to: payment.email,
    subject: "VETRA: your payment is being refunded",
    html: `<p>We received your payment of ${nairaLabel(amount)}, but couldn't turn it into an order (${escapeHtml(reason.toLowerCase())}). It's being refunded to ${refundDestination(channel)} in full; banks usually take 5 to 10 working days to show it.</p>`,
    logFallback: `late-payment refund notice for ${payment.email}: ${payment.reference}`,
  });
}

/**
 * Gives back the stock of checkouts nobody paid for. Checks Flutterwave once
 * first, so a payment whose webhook was missed is fulfilled, not cancelled.
 */
async function expireAbandonedCheckouts() {
  const [due] = await pool.query(
    `SELECT id, reference, cart_snapshot, TIMESTAMPDIFF(MINUTE, expires_at, NOW()) AS minutes_past
     FROM payments WHERE status = 'initialized' AND expires_at < NOW() LIMIT 100`
  );
  let expired = 0;
  for (const payment of due) {
    let result;
    try {
      result = await checkAndFinalizePayment(payment.reference);
    } catch (err) {
      console.error(`[payments] couldn't check ${payment.reference}, will retry:`, err.message);
      continue;
    }
    if (result.status !== "initialized") continue;
    // The buyer is still paying (a bank transfer can take a while to
    // land): keep holding the stock for a while longer.
    if (IN_PROGRESS_STATUSES.includes(result.providerStatus) && payment.minutes_past < IN_PROGRESS_GRACE_MINUTES) continue;
    const [abandon] = await pool.query(`UPDATE payments SET status = 'abandoned' WHERE id = ? AND status = 'initialized'`, [payment.id]);
    if (abandon.affectedRows === 1) {
      await releaseStock(pool, parseJson(payment.cart_snapshot).groups);
      expired += 1;
    }
  }
  return expired;
}

// ---------- Payouts ----------

/**
 * Records a payout for one job and tries to send it. A second call for
 * the same job is ignored (UNIQUE kind + source_id), so every trigger can
 * call this without checking first.
 */
async function queuePayout({ kind, userId, orderId = null, deliveryId = null, amount }) {
  if (!userId || !(amount > 0)) return null;
  const id = newId();
  const [result] = await pool.query(
    `INSERT IGNORE INTO payouts (id, kind, user_id, order_id, delivery_id, source_id, amount, reference)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, kind, userId, orderId, deliveryId, kind === "rider" ? deliveryId : orderId, amount, newReference("po")]
  );
  if (result.affectedRows !== 1) return null;
  await processPayout(id);
  return id;
}

async function markPayoutSucceeded(payout, transferCode = null) {
  const [result] = await pool.query(
    `UPDATE payouts SET status = 'success', completed_at = NOW(), failure_reason = NULL,
       transfer_code = COALESCE(?, transfer_code)
     WHERE id = ? AND status <> 'success'`,
    [transferCode, payout.id]
  );
  if (result.affectedRows !== 1) return;
  if (payout.kind === "rider" && payout.delivery_id) {
    await pool.query(`UPDATE deliveries SET rider_paid_at = COALESCE(rider_paid_at, NOW()) WHERE id = ?`, [payout.delivery_id]);
  }
  await notify({
    userId: payout.user_id,
    type: payout.kind === "rider" ? "delivery" : "order",
    title: "Payout sent",
    message: `${nairaLabel(payout.amount)} was sent to your bank account.`,
    link: payout.kind === "rider" ? "index.html" : "earnings.html",
  });
}

async function markPayoutFailed(payoutId, reason) {
  await pool.query(
    `UPDATE payouts SET status = 'failed', failure_reason = ? WHERE id = ? AND status NOT IN ('success', 'cancelled')`,
    [String(reason || "Transfer failed.").slice(0, 255), payoutId]
  );
}

function normalizeBankName(name) {
  return String(name || "").toLowerCase().replace(/\b(plc|limited|ltd|bank|nigeria|microfinance|mfb|of)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The Flutterwave bank code for a saved payout account. Accounts saved
 * while VETRA used Paystack carry Paystack's code; the big banks share
 * CBN codes on both, but some fintech and microfinance codes differ, so
 * an unknown code is matched by bank name instead. Null when neither works.
 */
async function flutterwaveBankCode(code, bankName) {
  const banks = await flutterwave.listBanks();
  if (banks.some((b) => b.code === code)) return code;
  const wanted = normalizeBankName(bankName);
  const match = wanted && banks.find((b) => normalizeBankName(b.name) === wanted);
  return match ? match.code : null;
}

/**
 * What Flutterwave knows about a payout's last attempt: by its transfer
 * id when the reply arrived, otherwise by VETRA's reference. Resolves to
 * null when Flutterwave has no such transfer.
 */
async function lookUpPreviousTransfer(payout) {
  if (payout.transfer_code) return flutterwave.getTransfer(payout.transfer_code);
  return flutterwave.findTransferByReference(payout.reference);
}

/**
 * Sends one payout if it can go now. Never throws; problems are recorded
 * on the row. `adminRetry` is a Super Admin pressing Retry: the only way
 * a payout first attempted through Paystack is sent again (after they
 * checked the Paystack dashboard that it wasn't paid).
 */
async function processPayout(payoutId, { adminRetry = false } = {}) {
  let [[payout]] = await pool.query(`SELECT * FROM payouts WHERE id = ?`, [payoutId]);
  if (!payout || !["queued", "awaiting_account", "failed"].includes(payout.status)) return;
  if (payout.provider === "paystack") {
    if (!adminRetry) return;
    // A fresh start on Flutterwave: new reference, no previous attempt to check.
    const reference = newReference("po");
    await pool.query(
      `UPDATE payouts SET provider = 'flutterwave', reference = ?, transfer_code = NULL, attempts = 0 WHERE id = ? AND provider = 'paystack'`,
      [reference, payoutId]
    );
    [[payout]] = await pool.query(`SELECT * FROM payouts WHERE id = ?`, [payoutId]);
  }
  const { autoPayoutsEnabled } = await getPaymentSettings();
  if (!autoPayoutsEnabled) {
    if (payout.status === "failed") return;
    await pool.query(`UPDATE payouts SET status = 'queued' WHERE id = ? AND status = 'awaiting_account'`, [payoutId]);
    return;
  }
  const [[payee]] = await pool.query(
    `SELECT id, name, payout_bank_name, payout_bank_code, payout_account_number_enc, payout_account_name FROM users WHERE id = ?`,
    [payout.user_id]
  );
  if (!payee?.payout_bank_code || !payee.payout_account_number_enc) {
    await pool.query(`UPDATE payouts SET status = 'awaiting_account' WHERE id = ? AND status NOT IN ('success', 'cancelled')`, [payoutId]);
    return;
  }

  try {
    // A retry first asks Flutterwave about the previous attempt, so a
    // transfer that went through (its reply just never arrived) is
    // recorded rather than sent a second time.
    let reference = payout.reference;
    if (payout.attempts > 0) {
      const previous = await lookUpPreviousTransfer(payout);
      if (previous && previous.status !== "failed") {
        if (previous.status === "success") await markPayoutSucceeded(payout, previous.transferCode);
        else {
          await pool.query(`UPDATE payouts SET status = 'processing', transfer_code = COALESCE(?, transfer_code) WHERE id = ?`, [previous.transferCode, payoutId]);
        }
        return;
      }
      if (previous) {
        // Failed: that reference is spent, retry under a new one.
        reference = newReference("po");
        await pool.query(`UPDATE payouts SET reference = ?, transfer_code = NULL WHERE id = ?`, [reference, payoutId]);
      }
      // No transfer found: the same reference is reused, and Flutterwave
      // refuses it if that attempt did reach it after all.
    }

    const bankCode = await flutterwaveBankCode(payee.payout_bank_code, payee.payout_bank_name);
    if (!bankCode) {
      // Waits for the payee to save their account again, which sends it
      // (processPendingPayoutsForUser).
      await pool.query(
        `UPDATE payouts SET status = 'awaiting_account', failure_reason = ? WHERE id = ? AND status NOT IN ('success', 'cancelled')`,
        [`Flutterwave doesn't list ${String(payee.payout_bank_name || "this bank").slice(0, 80)}. Waiting for the payee to save their payout account again.`, payoutId]
      );
      return;
    }

    const [claim] = await pool.query(
      `UPDATE payouts SET status = 'processing', attempts = attempts + 1, sent_at = NOW(), failure_reason = NULL
       WHERE id = ? AND status IN ('queued', 'awaiting_account', 'failed')`,
      [payoutId]
    );
    if (claim.affectedRows !== 1) return;

    let transfer;
    try {
      transfer = await flutterwave.initiateTransfer({
        amount: payout.amount,
        bankCode,
        accountNumber: decrypt(payee.payout_account_number_enc),
        accountName: payee.payout_account_name || payee.name,
        reference,
        narration: payout.kind === "rider" ? "VETRA delivery payout" : "VETRA sales payout",
      });
    } catch (err) {
      if (!flutterwave.isDuplicateReferenceError(err)) throw err;
      // An earlier attempt under this reference did reach Flutterwave.
      // Left 'processing': its transfer.completed webhook finishes it.
      await pool.query(
        `UPDATE payouts SET failure_reason = 'Flutterwave already has a transfer with this reference. Waiting for its result.' WHERE id = ?`,
        [payoutId]
      );
      return;
    }
    await pool.query(`UPDATE payouts SET transfer_code = ? WHERE id = ?`, [transfer.transferCode || null, payoutId]);
    if (transfer.status === "success") await markPayoutSucceeded({ ...payout, reference }, transfer.transferCode);
    else if (transfer.status === "failed") await markPayoutFailed(payoutId, transfer.reason || "Flutterwave rejected the transfer.");
    // 'pending' (NEW / PENDING): the transfer.completed webhook finishes it.
  } catch (err) {
    console.error(`[payments] payout ${payoutId} failed:`, err.adminMessage || err.message);
    // adminMessage is the specific cause (IP not whitelisted, bad key)
    // where err.message is only the buyer-facing "not available".
    const reason = err.adminMessage
      ? err.adminMessage
      : /insufficient|not enough|low balance|balance is/i.test(err.message)
      ? "The Flutterwave NGN balance can't cover this payout. Top up the balance in the Flutterwave dashboard, then retry."
      : /approv/i.test(err.message)
        ? "Flutterwave is holding this transfer for approval. Approve it in the Flutterwave dashboard, or turn off transfer approval there."
        : err.message;
    await markPayoutFailed(payoutId, reason);
  }
}

/**
 * Super Admin cancel of a payout that hasn't gone through, so it's never
 * sent or retried. A payout that was already attempted is checked with
 * Flutterwave first: a transfer that actually went through (or is still
 * in flight) can't be cancelled, and one that succeeded is recorded as
 * paid. One attempted through Paystack can't be checked any more; the
 * Super Admin checks the Paystack dashboard before cancelling it.
 */
async function cancelPayout(payoutId, { reason, actorUserId }) {
  const [[payout]] = await pool.query(`SELECT * FROM payouts WHERE id = ?`, [payoutId]);
  if (!payout) throw new PaymentError("Payout not found.", 404);
  if (!["failed", "queued", "awaiting_account"].includes(payout.status)) {
    throw new PaymentError("Only a payout that hasn't gone through can be cancelled.", 409);
  }
  if (payout.attempts > 0 && payout.provider !== "paystack") {
    let previous;
    try {
      previous = await lookUpPreviousTransfer(payout);
    } catch (err) {
      throw new PaymentError(`Couldn't check this payout with Flutterwave, so it wasn't cancelled. ${err.message}`, 502);
    }
    if (previous?.status === "success") {
      await markPayoutSucceeded(payout, previous.transferCode);
      throw new PaymentError("Flutterwave shows this payout already went through, so it's now marked as paid.", 409);
    }
    if (previous?.status === "pending") {
      await pool.query(`UPDATE payouts SET status = 'processing' WHERE id = ? AND status = ?`, [payoutId, payout.status]);
      throw new PaymentError("Flutterwave is still processing this payout, so it can't be cancelled.", 409);
    }
  }
  const [claim] = await pool.query(
    `UPDATE payouts SET status = 'cancelled', cancel_reason = ?, cancelled_by_user_id = ?, cancelled_at = NOW()
     WHERE id = ? AND status IN ('failed', 'queued', 'awaiting_account')`,
    [String(reason).slice(0, 255), actorUserId, payoutId]
  );
  if (claim.affectedRows !== 1) throw new PaymentError("This payout changed while cancelling it. Refresh and try again.", 409);

  await notify({
    userId: payout.user_id,
    type: payout.kind === "rider" ? "delivery" : "order",
    title: "Payout cancelled",
    message: `A payout of ${nairaLabel(payout.amount)} was cancelled by VETRA: ${escapeHtml(String(reason).slice(0, 200))}. Contact support if you think this is a mistake.`,
    link: payout.kind === "rider" ? "index.html" : "earnings.html",
  });
  await logActivity({
    type: "order",
    message: `Cancelled a ${nairaLabel(payout.amount)} ${payout.kind} payout: ${escapeHtml(String(reason).slice(0, 200))}.`,
    actorUserId,
    targetType: payout.kind,
    targetId: payout.user_id,
  });
}

/**
 * Webhook: transfer.completed, with data.status SUCCESSFUL or FAILED.
 * The webhook body is only a hint: the transfer is looked up again with
 * Flutterwave before anything is recorded.
 */
async function handleTransferEvent(data) {
  const [[payout]] = await pool.query(`SELECT * FROM payouts WHERE reference = ? AND provider = 'flutterwave'`, [data?.reference]);
  if (!payout || ["success", "cancelled"].includes(payout.status)) return;
  const transfer = (data?.id != null && await flutterwave.getTransfer(data.id)) || null;
  if (!transfer || transfer.reference !== payout.reference) return;
  if (transfer.status === "success") {
    await markPayoutSucceeded(payout, transfer.transferCode);
  } else if (transfer.status === "failed") {
    await markPayoutFailed(payout.id, transfer.reason || "Transfer failed.");
  }
}

/** Runs any payouts that were only waiting for this user to add a bank account. */
async function processPendingPayoutsForUser(userId) {
  const [rows] = await pool.query(`SELECT id FROM payouts WHERE user_id = ? AND status = 'awaiting_account'`, [userId]);
  for (const row of rows) await processPayout(row.id);
}

/** Rider payout for a delivered or returned job. Only for paid orders. */
async function payRiderForDelivery(deliveryId) {
  const [[row]] = await pool.query(
    `SELECT d.id, d.rider_id, d.rider_payout, o.payment_id
     FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.id = ?`,
    [deliveryId]
  );
  if (!row?.payment_id || !row.rider_id) return null;
  return queuePayout({ kind: "rider", userId: row.rider_id, deliveryId: row.id, amount: row.rider_payout });
}

/** Vendor payout once escrow has released: goods minus commission, plus the fee if they shipped it themselves. */
async function payVendorForOrder(orderId) {
  const [[order]] = await pool.query(
    `SELECT o.id, o.vendor_id, o.total, o.delivery_fee, o.payment_id, o.commission_percent, d.mode AS delivery_mode
     FROM orders o LEFT JOIN deliveries d ON d.order_id = o.id WHERE o.id = ?`,
    [orderId]
  );
  if (!order?.payment_id) return null;
  const commission = Math.round((order.total * Number(order.commission_percent || 0)) / 100);
  await pool.query(`UPDATE orders SET commission_amount = ? WHERE id = ?`, [commission, orderId]);
  const amount = order.total - commission + (order.delivery_mode === "self" ? order.delivery_fee : 0);
  return queuePayout({ kind: "vendor", userId: order.vendor_id, orderId, amount });
}

// ---------- Refunds ----------

const PAYSTACK_REFUND_MESSAGE = "Paid through Paystack, which VETRA no longer uses. Make this refund in the Paystack dashboard.";

async function sendRefund(refundId, amount) {
  const [[payment]] = await pool.query(
    `SELECT p.provider, p.provider_transaction_id FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.id = ?`,
    [refundId]
  );
  if (payment?.provider === "paystack") {
    await pool.query(`UPDATE refunds SET status = 'failed', failure_reason = ? WHERE id = ?`, [PAYSTACK_REFUND_MESSAGE, refundId]);
    return;
  }
  if (!payment?.provider_transaction_id) {
    await pool.query(
      `UPDATE refunds SET status = 'failed', failure_reason = 'No Flutterwave transaction is recorded for this payment, so it can't be refunded automatically.' WHERE id = ?`,
      [refundId]
    );
    return;
  }
  try {
    const result = await flutterwave.createRefund({ transactionId: payment.provider_transaction_id, amount });
    await pool.query(`UPDATE refunds SET provider_refund_id = ? WHERE id = ?`, [result.id, refundId]);
    // 'pending' stays 'processing' until the cron (checkPendingRefunds) sees it finish.
    if (result.status !== "pending") await applyRefundStatus(refundId, result.status);
  } catch (err) {
    console.error(`[payments] refund ${refundId} failed:`, err.message);
    const reason = err.status === 502
      ? `${err.message} Check the Flutterwave dashboard before retrying, it may have gone through.`
      : err.message;
    await pool.query(`UPDATE refunds SET status = 'failed', failure_reason = ? WHERE id = ?`, [reason.slice(0, 255), refundId]);
  }
}

/** What the buyer paid for this order (goods as ordered + delivery) minus what's already been refunded. */
async function refundableAmount(orderId, db = pool) {
  const [[row]] = await db.query(
    `SELECT o.delivery_fee, o.refunded_amount,
            (SELECT COALESCE(SUM(oi.price_at_purchase * oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS goods_paid
     FROM orders o WHERE o.id = ?`,
    [orderId]
  );
  if (!row) return 0;
  return Number(row.goods_paid) + Number(row.delivery_fee) - Number(row.refunded_amount);
}

/**
 * Refunds part or all of an order to the card or account the buyer paid with. `amount` is kobo,
 * or 'remaining' for everything not yet refunded. The processing fee is
 * never included: Flutterwave keeps its fee on a refund.
 */
async function refundOrder(orderId, amount, reason, { actorUserId = null } = {}) {
  const [[order]] = await pool.query(
    `SELECT o.id, o.payment_id, o.buyer_id, o.tracking_code, p.reference, p.email, p.channel
     FROM orders o JOIN payments p ON p.id = o.payment_id WHERE o.id = ?`,
    [orderId]
  );
  if (!order) return null;
  const remaining = await refundableAmount(orderId);
  const value = amount === "remaining" ? remaining : Math.min(Number(amount), remaining);
  if (!(value > 0)) return null;

  // Re-checks the cap atomically, so two refunds racing can't together
  // exceed what the buyer paid.
  const [claim] = await pool.query(
    `UPDATE orders SET refunded_amount = refunded_amount + ?
     WHERE id = ? AND refunded_amount + ? <= delivery_fee +
       (SELECT COALESCE(SUM(oi.price_at_purchase * oi.quantity), 0) FROM order_items oi WHERE oi.order_id = ?)`,
    [value, orderId, value, orderId]
  );
  if (claim.affectedRows !== 1) return null;
  const refundId = newId();
  await pool.query(
    `INSERT INTO refunds (id, order_id, payment_id, amount, reason) VALUES (?, ?, ?, ?, ?)`,
    [refundId, orderId, order.payment_id, value, reason ? String(reason).slice(0, 255) : null]
  );
  await sendRefund(refundId, value);

  const ref = orderRef(order);
  await logActivity({
    type: "order",
    message: `${nairaLabel(value)} refunded on <strong>${ref}</strong>${reason ? `: ${escapeHtml(String(reason).slice(0, 200))}` : ""}.`,
    actorUserId,
    targetType: "order",
    targetId: orderId,
  });
  if (order.buyer_id) {
    await notify({
      userId: order.buyer_id,
      type: "order",
      title: "Refund on its way",
      message: `${nairaLabel(value)} for ${ref} is being refunded to ${refundDestination(order.channel)}. Banks usually take 5 to 10 working days.`,
      link: "orders.html",
    });
  }
  return refundId;
}

/** Super Admin retry of a failed refund, after checking Flutterwave that it didn't go through. */
async function retryRefund(refundId) {
  const [[refund]] = await pool.query(
    `SELECT r.id, r.amount, r.status, p.provider FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.id = ?`,
    [refundId]
  );
  if (!refund) throw new PaymentError("Refund not found.", 404);
  if (refund.provider === "paystack") throw new PaymentError(`${PAYSTACK_REFUND_MESSAGE} Once it's made there, leave this one as it is: cancelling it would stop it counting as refunded on the order.`, 409);
  const [claim] = await pool.query(
    `UPDATE refunds SET status = 'processing', failure_reason = NULL WHERE id = ? AND status = 'failed'`,
    [refundId]
  );
  if (claim.affectedRows !== 1) throw new PaymentError("Only a failed refund can be retried.", 409);
  await sendRefund(refundId, refund.amount);
}

/**
 * Super Admin cancel of a failed refund: it's never retried, and its
 * amount stops counting as refunded on the order, so the buyer's order
 * page no longer shows it and the order can be refunded again later.
 */
async function cancelRefund(refundId, { reason, actorUserId }) {
  const [[refund]] = await pool.query(
    `SELECT r.id, r.order_id, r.amount, r.status, o.tracking_code
     FROM refunds r LEFT JOIN orders o ON o.id = r.order_id WHERE r.id = ?`,
    [refundId]
  );
  if (!refund) throw new PaymentError("Refund not found.", 404);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [claim] = await conn.query(
      `UPDATE refunds SET status = 'cancelled', cancel_reason = ?, cancelled_by_user_id = ?, cancelled_at = NOW()
       WHERE id = ? AND status = 'failed'`,
      [String(reason).slice(0, 255), actorUserId, refundId]
    );
    if (claim.affectedRows !== 1) throw new PaymentError("Only a failed refund can be cancelled.", 409);
    if (refund.order_id) {
      await conn.query(
        `UPDATE orders SET refunded_amount = GREATEST(refunded_amount - ?, 0) WHERE id = ?`,
        [refund.amount, refund.order_id]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await logActivity({
    type: "order",
    message: `Cancelled a failed ${nairaLabel(refund.amount)} refund${refund.order_id ? ` on <strong>${orderRef({ id: refund.order_id, tracking_code: refund.tracking_code })}</strong>` : ""}: ${escapeHtml(String(reason).slice(0, 200))}.`,
    actorUserId,
    targetType: "refund",
    targetId: refundId,
  });
}

/** Records a refund's final status ('processed' or 'failed') from Flutterwave. */
async function applyRefundStatus(refundId, status) {
  if (status === "processed") {
    // A refund cancelled after a timeout may still have gone through:
    // Flutterwave is the truth, so it counts as refunded on the order again.
    const [[row]] = await pool.query(`SELECT status, order_id, amount FROM refunds WHERE id = ?`, [refundId]);
    const [done] = await pool.query(`UPDATE refunds SET status = 'processed', completed_at = NOW() WHERE id = ? AND status <> 'processed'`, [refundId]);
    if (done.affectedRows === 1 && row.status === "cancelled" && row.order_id) {
      await pool.query(`UPDATE orders SET refunded_amount = refunded_amount + ? WHERE id = ?`, [row.amount, row.order_id]);
    }
  } else if (status === "failed") {
    await pool.query(
      `UPDATE refunds SET status = 'failed', failure_reason = 'Flutterwave reported the refund failed.' WHERE id = ? AND status NOT IN ('cancelled', 'processed')`,
      [refundId]
    );
  }
}

/**
 * Webhook for a refund, if Flutterwave sends one. Like transfers, the
 * body is only a hint: the refund is looked up with Flutterwave again.
 */
async function handleRefundEvent(data) {
  const providerId = data?.id || data?.refund_id || null;
  if (!providerId) return;
  const [[refund]] = await pool.query(`SELECT id FROM refunds WHERE provider_refund_id = ?`, [providerId]);
  if (!refund) return;
  const current = await flutterwave.getRefund(providerId);
  if (current.status !== "pending") await applyRefundStatus(refund.id, current.status);
}

/**
 * Cron: payouts still 'processing' half an hour after they were sent are
 * looked up with Flutterwave, in case the transfer.completed webhook was
 * missed.
 */
async function checkStuckPayouts() {
  const [rows] = await pool.query(
    `SELECT * FROM payouts
     WHERE status = 'processing' AND provider = 'flutterwave' AND sent_at < NOW() - INTERVAL 30 MINUTE
     ORDER BY sent_at LIMIT 50`
  );
  let settled = 0;
  for (const payout of rows) {
    try {
      const transfer = await lookUpPreviousTransfer(payout);
      if (transfer?.status === "success") await markPayoutSucceeded(payout, transfer.transferCode);
      else if (transfer?.status === "failed") await markPayoutFailed(payout.id, transfer.reason || "Transfer failed.");
      else continue;
      settled += 1;
    } catch (err) {
      console.error(`[payments] couldn't check payout ${payout.id}, will retry:`, err.message);
    }
  }
  return settled;
}

/** Cron: asks Flutterwave how each refund still in progress went. */
async function checkPendingRefunds() {
  const [rows] = await pool.query(
    `SELECT id, provider_refund_id FROM refunds
     WHERE status = 'processing' AND provider_refund_id IS NOT NULL AND created_at < NOW() - INTERVAL 5 MINUTE
     ORDER BY created_at LIMIT 50`
  );
  let settled = 0;
  for (const row of rows) {
    try {
      const current = await flutterwave.getRefund(row.provider_refund_id);
      if (current.status === "pending") continue;
      await applyRefundStatus(row.id, current.status);
      settled += 1;
    } catch (err) {
      console.error(`[payments] couldn't check refund ${row.id}, will retry:`, err.message);
    }
  }
  return settled;
}

// ---------- Scheduled sweep ----------

/** Run from scripts/delivery-cron.js alongside the delivery sweep. */
async function runPaymentsCron() {
  const summary = { checkoutsExpired: 0, payoutsAttempted: 0, payoutsSettled: 0, refundsSettled: 0 };
  summary.checkoutsExpired = await expireAbandonedCheckouts();
  summary.payoutsSettled = await checkStuckPayouts();
  summary.refundsSettled = await checkPendingRefunds();
  const { autoPayoutsEnabled } = await getPaymentSettings();
  if (autoPayoutsEnabled) {
    const [due] = await pool.query(
      `SELECT p.id FROM payouts p JOIN users u ON u.id = p.user_id
       WHERE p.provider = 'flutterwave' AND (
             p.status = 'queued'
          OR (p.status = 'awaiting_account' AND u.payout_account_number_enc IS NOT NULL)
          OR (p.status = 'failed' AND p.attempts < ? AND (p.sent_at IS NULL OR p.sent_at < NOW() - INTERVAL ? MINUTE)))
       ORDER BY p.created_at LIMIT 100`,
      [MAX_PAYOUT_ATTEMPTS, RETRY_INTERVAL_MINUTES]
    );
    for (const row of due) {
      await processPayout(row.id);
      summary.payoutsAttempted += 1;
    }
  }
  return summary;
}

module.exports = {
  PaymentError,
  processingFee,
  getPaymentSettings,
  startCheckout,
  finalizePayment,
  expireAbandonedCheckouts,
  queuePayout,
  processPayout,
  cancelPayout,
  handleTransferEvent,
  processPendingPayoutsForUser,
  payRiderForDelivery,
  payVendorForOrder,
  refundOrder,
  refundableAmount,
  retryRefund,
  cancelRefund,
  handleRefundEvent,
  runPaymentsCron,
};
