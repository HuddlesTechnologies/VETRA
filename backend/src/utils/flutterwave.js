/* =========================================================
   Flutterwave REST client (API v3). No SDK: every call is a plain
   fetch() to https://api.flutterwave.com/v3 with the secret key as a
   Bearer token.

   Flutterwave amounts are in naira; everything else in VETRA is kobo.
   This file is the only place that converts: every function takes and
   returns kobo.

   Read-only helpers:
   - listBanks(): the searchable bank dropdown on payout account forms.
   - resolveAccountNumber(): turns a bank code + NUBAN into the real,
     bank-registered account name, so nobody hand-types (and can't
     spoof) the name on their own payout account.
   - getBalance(): the Super Admin dashboard's balance card.

   Money movement, used only by utils/payments.js:
   - initializeTransaction() / verifyTransaction(): buyer checkout
     (Flutterwave Standard, the hosted payment page).
   - initiateTransfer() / getTransfer() / findTransferByReference():
     vendor and rider payouts, paid from the Flutterwave NGN balance.
   - createRefund() / getRefund(): back to whatever the buyer paid with.
   - verifyWebhookSignature(): authenticates POST /api/payments/webhook.

   Every charge and transfer carries a reference VETRA generated and
   stored first, and Flutterwave refuses a duplicate reference, so a
   retry after a timeout can never charge or pay twice.
   ========================================================= */

const crypto = require("crypto");

const FLUTTERWAVE_BASE = "https://api.flutterwave.com/v3";
const REQUEST_TIMEOUT_MS = 20000;

const toNaira = (kobo) => Math.round(Number(kobo)) / 100;
const toKobo = (naira) => Math.round(Number(naira || 0) * 100);

const NOT_AVAILABLE = "Payments aren't available right now. Please try again later or contact VETRA support.";

// FLW_SECRET_KEY as set, without quotes or whitespace a copy-paste into
// cPanel's environment editor can leave behind.
function secretKey() {
  return String(process.env.FLW_SECRET_KEY || "").trim().replace(/^["']|["']$/g, "").trim();
}

// Why Flutterwave might have answered its vague "Invalid authorization
// key", judged from the key's shape. Only used to explain a rejection,
// never to block a request. Only Super Admins (the balance card) and the
// server log see these; buyers get NOT_AVAILABLE.
function keyProblem(key) {
  if (/^FLWSECK(_TEST)?-[A-Za-z0-9]+-X$/.test(key)) return null;
  if (/^FLWPUBK/i.test(key)) return "FLW_SECRET_KEY holds the public key (FLWPUBK-...). Use the secret key (FLWSECK-...) from Flutterwave > Settings > API Keys.";
  if (/^FLWSECK/i.test(key)) return "FLW_SECRET_KEY starts like a secret key but isn't complete. Copy the whole secret key again (it ends in -X).";
  return "FLW_SECRET_KEY isn't a Flutterwave v3 secret key (FLWSECK-...-X). If your dashboard only shows a Client ID and Client Secret (API v4), switch to the v3 keys under Settings > API Keys, or contact Flutterwave to get v3 keys.";
}

function requireKey() {
  const key = secretKey();
  if (!key) {
    // 503, not the error handler's default 500: this is a missing
    // setting, and the user should see why rather than "Something went wrong."
    throw Object.assign(new Error(NOT_AVAILABLE), { status: 503, adminMessage: "FLW_SECRET_KEY is not set on the server." });
  }
  return key;
}

function isTestMode() {
  return /^FLWSECK_TEST-/.test(secretKey());
}

async function flwRequest(method, path, body) {
  let res;
  try {
    res = await fetch(`${FLUTTERWAVE_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${requireKey()}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause.status === 503) throw cause;
    throw Object.assign(new Error(cause.name === "TimeoutError" ? "Flutterwave timed out." : "Flutterwave could not be reached."), { status: 502 });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body, data stays null, message below falls back */
  }
  if (res.status === 401 || /invalid authori[sz]ation key/i.test(data?.message || "")) {
    // The key has the right shape but Flutterwave doesn't accept it:
    // revoked, regenerated, or from another account.
    const adminMessage = keyProblem(secretKey())
      || "Flutterwave rejected FLW_SECRET_KEY. It may have been regenerated or belong to another account: copy the current secret key from Flutterwave > Settings > API Keys and restart the app.";
    console.error(`[flutterwave] ${adminMessage}`);
    throw Object.assign(new Error(NOT_AVAILABLE), { status: 503, providerStatus: res.status, adminMessage });
  }
  if (!res.ok || data?.status !== "success") {
    throw Object.assign(new Error(data?.message || `Flutterwave request failed (${res.status}).`), {
      status: res.status >= 500 ? 502 : 422,
      providerStatus: res.status,
    });
  }
  return data.data;
}

const flwGet = (path) => flwRequest("GET", path);
const flwPost = (path, body) => flwRequest("POST", path, body);

// In-memory cache, Nigeria's bank list changes rarely, so there's no
// reason to hit Flutterwave on every page load of the payout form.
// Resets on a deploy/restart, which is fine.
let bankListCache = null;
let bankListCachedAt = 0;
const BANK_LIST_TTL_MS = 24 * 60 * 60 * 1000;

async function listBanks() {
  if (bankListCache && Date.now() - bankListCachedAt < BANK_LIST_TTL_MS) {
    return bankListCache;
  }
  const data = await flwGet("/banks/NG");
  const seen = new Set();
  bankListCache = data
    .map((b) => ({ name: String(b.name || "").trim(), code: String(b.code || "").trim() }))
    .filter((b) => b.name && b.code && !seen.has(b.code) && seen.add(b.code))
    .sort((a, b) => a.name.localeCompare(b.name));
  bankListCachedAt = Date.now();
  return bankListCache;
}

async function resolveAccountNumber(accountNumber, bankCode) {
  let data;
  try {
    data = await flwPost("/accounts/resolve", { account_number: accountNumber, account_bank: bankCode });
  } catch (err) {
    if (err.status === 422) err.message = "We couldn't find this account at the selected bank. Check the account number and bank.";
    throw err;
  }
  return { accountName: data.account_name, accountNumber: data.account_number };
}

// Flutterwave's available NGN balance, in kobo, in the same shape the
// Paystack version returned so the admin cards didn't need to change.
async function getBalance() {
  const data = await flwGet("/balances/NGN");
  return [{ currency: data.currency || "NGN", balance: toKobo(data.available_balance), ledgerBalance: toKobo(data.ledger_balance) }];
}

// ---------- Checkout ----------

async function initializeTransaction({ email, name, phone, amount, reference, callbackUrl, metadata }) {
  const data = await flwPost("/payments", {
    tx_ref: reference,
    amount: toNaira(amount),
    currency: "NGN",
    redirect_url: callbackUrl,
    customer: { email, ...(name ? { name } : {}), ...(phone ? { phonenumber: phone } : {}) },
    meta: metadata,
    customizations: { title: "VETRA", description: "Payment for your VETRA order" },
  });
  return { authorizationUrl: data.link };
}

// Flutterwave's payment_type, in the channel names VETRA already stores
// (payments.channel, read by orderEmail.js's refundDestination()).
const CHANNEL = {
  card: "card",
  account: "bank",
  bank_transfer: "bank_transfer",
  ussd: "ussd",
  applepay: "apple_pay",
  googlepay: "google_pay",
  opay: "opay",
  barter: "barter",
  enaira: "enaira",
  mobilemoneyghana: "mobile_money",
};

// Flutterwave gives no card fingerprint the way Paystack did, so one is
// built from what identifies the card: BIN, last four, expiry and issuer.
// The same card gives the same value on any account (used by bans,
// utils/identifiers.js).
function cardFingerprint(card) {
  if (!card?.first_6digits || !card?.last_4digits) return null;
  const parts = [card.first_6digits, card.last_4digits, card.expiry || "", String(card.issuer || "").toUpperCase().trim()];
  return `flw_${crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40)}`;
}

// Normalized status: 'success', 'failed', or a still-in-progress value
// ('pending'), which payments.js treats as "keep waiting".
function chargeStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "successful") return "success";
  if (s === "failed" || s === "cancelled") return "failed";
  return s || "pending";
}

async function verifyTransaction(reference) {
  const data = await flwGet(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
  return {
    status: chargeStatus(data.status),
    // What the buyer was charged: includes Flutterwave's fee while the
    // dashboard has customers bear it.
    amount: toKobo(data.charged_amount ?? data.amount),
    // What VETRA asked for.
    requestedAmount: toKobo(data.amount),
    currency: data.currency,
    id: data.id,
    channel: CHANNEL[String(data.payment_type || "").toLowerCase()] || data.payment_type || null,
    cardSignature: cardFingerprint(data.card),
    paidAt: data.created_at || null,
    reference: data.tx_ref,
  };
}

// ---------- Payouts ----------

// Flutterwave transfer statuses -> the ones payments.js uses.
function transferStatus(status) {
  const s = String(status || "").toUpperCase();
  if (s === "SUCCESSFUL") return "success";
  if (s === "FAILED") return "failed";
  return "pending"; // NEW, PENDING
}

function mapTransfer(data) {
  return {
    status: transferStatus(data.status),
    transferCode: data.id != null ? String(data.id) : null,
    reason: data.complete_message || null,
    reference: data.reference,
  };
}

// Straight to the bank account: Flutterwave doesn't need a saved
// recipient first. Resolves to { status: 'pending' | 'success' | 'failed', transferCode }.
async function initiateTransfer({ amount, bankCode, accountNumber, accountName, reference, narration }) {
  const data = await flwPost("/transfers", {
    account_bank: bankCode,
    account_number: accountNumber,
    amount: toNaira(amount),
    currency: "NGN",
    debit_currency: "NGN",
    reference,
    narration,
    ...(accountName ? { beneficiary_name: accountName } : {}),
  });
  return mapTransfer(data);
}

// Looks a transfer up by Flutterwave's id (stored as payouts.transfer_code).
// Resolves to null when Flutterwave has no such transfer.
async function getTransfer(transferId) {
  try {
    return mapTransfer(await flwGet(`/transfers/${encodeURIComponent(transferId)}`));
  } catch (err) {
    if (err.providerStatus === 404 || err.providerStatus === 400) return null;
    throw err;
  }
}

// For an attempt whose reply never arrived, so its id was never stored.
// Only an exact reference match counts.
async function findTransferByReference(reference) {
  const data = await flwGet(`/transfers?reference=${encodeURIComponent(reference)}`);
  const match = (Array.isArray(data) ? data : []).find((t) => t.reference === reference);
  return match ? mapTransfer(match) : null;
}

function isDuplicateReferenceError(err) {
  return /duplicate|already exist/i.test(String(err?.message || ""));
}

// ---------- Refunds ----------

// Normalized: 'processed', 'failed', or 'pending'.
function refundStatus(status) {
  const s = String(status || "").toLowerCase();
  if (["completed", "successful", "success"].includes(s)) return "processed";
  if (s === "failed") return "failed";
  return "pending";
}

// Refunds go by Flutterwave's transaction id (payments.provider_transaction_id).
async function createRefund({ transactionId, amount }) {
  const data = await flwPost(`/transactions/${encodeURIComponent(transactionId)}/refund`, { amount: toNaira(amount) });
  return { id: data.id || null, status: refundStatus(data.status) };
}

async function getRefund(refundId) {
  const data = await flwGet(`/refunds/${encodeURIComponent(refundId)}`);
  return { id: data.id || refundId, status: refundStatus(data.status) };
}

// ---------- Webhooks ----------

function safeEqual(a, b) {
  const x = Buffer.from(String(a), "utf8");
  const y = Buffer.from(String(b), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Flutterwave sends the "Secret hash" set in Dashboard > Settings >
// Webhooks in the verif-hash header. Newer accounts also send
// flutterwave-signature: base64 HMAC-SHA256 of the raw body, keyed with
// the same secret hash. Either one matching is enough.
function verifyWebhookSignature(rawBody, headers) {
  const secret = process.env.FLW_WEBHOOK_HASH;
  if (!secret || !rawBody) return false;
  const verifHash = headers["verif-hash"];
  if (typeof verifHash === "string" && safeEqual(verifHash, secret)) return true;
  const signature = headers["flutterwave-signature"];
  if (typeof signature === "string") {
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
    return safeEqual(signature, expected);
  }
  return false;
}

module.exports = {
  isTestMode,
  listBanks,
  resolveAccountNumber,
  getBalance,
  initializeTransaction,
  verifyTransaction,
  initiateTransfer,
  getTransfer,
  findTransferByReference,
  isDuplicateReferenceError,
  createRefund,
  getRefund,
  verifyWebhookSignature,
};
