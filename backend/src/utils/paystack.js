/* =========================================================
   Paystack REST client. No SDK: every call is a plain fetch().

   Read-only helpers:
   - listBanks(): the searchable bank dropdown on payout account forms.
   - resolveAccountNumber(): turns a bank code + NUBAN into the real,
     bank-registered account name, so nobody hand-types (and can't
     spoof) the name on their own payout account.
   - getBalance(): the Super Admin dashboard's balance card.

   Money movement, used only by utils/payments.js:
   - initializeTransaction() / verifyTransaction(): buyer checkout.
   - createTransferRecipient() / initiateTransfer(): vendor and rider
     payouts, paid from the Paystack balance.
   - createRefund(): back to the buyer's card.
   - verifyWebhookSignature(): authenticates POST /api/payments/webhook.

   Every call that moves money carries a reference VETRA generated and
   stored first, and Paystack refuses a duplicate reference, so a retry
   after a timeout can never charge or pay twice.
   ========================================================= */

const crypto = require("crypto");

const PAYSTACK_BASE = "https://api.paystack.co";
const REQUEST_TIMEOUT_MS = 20000;

function requireKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    // 503, not the error handler's default 500: this is a missing
    // setting, and the user should see why rather than "Something went wrong."
    throw Object.assign(new Error("Payments aren't available right now. Please try again later or contact VETRA support."), { status: 503 });
  }
  return key;
}

async function paystackRequest(method, path, body) {
  let res;
  try {
    res = await fetch(`${PAYSTACK_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${requireKey()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause.status === 503) throw cause;
    throw Object.assign(new Error(cause.name === "TimeoutError" ? "Paystack timed out." : "Paystack could not be reached."), { status: 502 });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body, data stays null, message below falls back */
  }
  if (!res.ok || !data?.status) {
    throw Object.assign(new Error(data?.message || `Paystack request failed (${res.status}).`), {
      status: res.status >= 500 ? 502 : 422,
      paystackStatus: res.status,
    });
  }
  return data.data;
}

const paystackGet = (path) => paystackRequest("GET", path);
const paystackPost = (path, body) => paystackRequest("POST", path, body);

// In-memory cache, Nigeria's bank list changes rarely (a new
// mobile-money/microfinance license every few months at most), so
// there's no reason to hit Paystack on every single page load of the
// payout form. Resets on a deploy/restart, which is fine.
let bankListCache = null;
let bankListCachedAt = 0;
const BANK_LIST_TTL_MS = 24 * 60 * 60 * 1000;

async function listBanks() {
  if (bankListCache && Date.now() - bankListCachedAt < BANK_LIST_TTL_MS) {
    return bankListCache;
  }
  const data = await paystackGet("/bank?country=nigeria&currency=NGN");
  bankListCache = data.map((b) => ({ name: b.name, code: b.code }));
  bankListCachedAt = Date.now();
  return bankListCache;
}

async function resolveAccountNumber(accountNumber, bankCode) {
  const data = await paystackGet(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
  );
  return { accountName: data.account_name, accountNumber: data.account_number };
}

// Paystack's available balance, per currency, in kobo.
async function getBalance() {
  const data = await paystackGet("/balance");
  return data.map((b) => ({ currency: b.currency, balance: b.balance }));
}

// ---------- Checkout ----------

async function initializeTransaction({ email, amount, reference, callbackUrl, metadata }) {
  const data = await paystackPost("/transaction/initialize", {
    email,
    amount,
    currency: "NGN",
    reference,
    callback_url: callbackUrl,
    metadata,
  });
  return { authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
}

async function verifyTransaction(reference) {
  const data = await paystackGet(`/transaction/verify/${encodeURIComponent(reference)}`);
  return {
    status: data.status,
    amount: data.amount,
    // What VETRA asked for. Differs from `amount` when the Paystack
    // dashboard passes its fees on to the customer.
    requestedAmount: data.requested_amount ?? data.amount,
    currency: data.currency,
    id: data.id,
    channel: data.channel || null,
    // Paystack's fingerprint of the card: the same card gives the same
    // value on any account (used by bans, utils/identifiers.js).
    cardSignature: data.authorization?.signature || null,
    paidAt: data.paid_at || data.paidAt || null,
    reference: data.reference,
  };
}

// ---------- Payouts ----------

async function createTransferRecipient({ name, accountNumber, bankCode }) {
  const data = await paystackPost("/transferrecipient", {
    type: "nuban",
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: "NGN",
  });
  return data.recipient_code;
}

// Resolves to Paystack's transfer status: 'pending' or 'success' while it
// goes through, 'otp' if the account still requires OTP confirmation for
// transfers (Paystack dashboard > Settings > Preferences), 'failed'.
async function initiateTransfer({ amount, recipientCode, reference, reason }) {
  const data = await paystackPost("/transfer", {
    source: "balance",
    amount,
    recipient: recipientCode,
    reference,
    reason,
    currency: "NGN",
  });
  return { status: data.status, transferCode: data.transfer_code };
}

// Looks a transfer up by VETRA's own reference. Used before retrying a
// payout, so a transfer that actually went through (its response just
// never arrived) is recorded instead of sent again. Resolves to null when
// Paystack has no transfer with that reference.
async function verifyTransfer(reference) {
  try {
    const data = await paystackGet(`/transfer/verify/${encodeURIComponent(reference)}`);
    return { status: data.status, transferCode: data.transfer_code, reason: data.reason || null };
  } catch (err) {
    if (err.paystackStatus === 404 || err.paystackStatus === 400) return null;
    throw err;
  }
}

// ---------- Refunds ----------

async function createRefund({ transactionReference, amount }) {
  const data = await paystackPost("/refund", { transaction: transactionReference, amount });
  return { id: data.id || null, status: data.status || null };
}

// ---------- Webhooks ----------

// Paystack signs every webhook with HMAC-SHA512 of the raw request body,
// keyed with the secret key, in the x-paystack-signature header.
function verifyWebhookSignature(rawBody, signature) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !rawBody || typeof signature !== "string") return false;
  const expected = crypto.createHmac("sha512", key).update(rawBody).digest("hex");
  const given = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

module.exports = {
  listBanks,
  resolveAccountNumber,
  getBalance,
  initializeTransaction,
  verifyTransaction,
  createTransferRecipient,
  initiateTransfer,
  verifyTransfer,
  createRefund,
  verifyWebhookSignature,
};
