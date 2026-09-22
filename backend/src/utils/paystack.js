/* =========================================================
   Paystack "Miscellaneous" API, just the two read-only calls
   vendor/earnings.html's payout account form needs:

   - listBanks(): the searchable bank dropdown's options.
   - resolveAccountNumber(): turns a bank code + NUBAN into the real,
     bank-registered account name, so a vendor never hand-types (and
     can't spoof) the name on their own payout account, see
     backend/src/routes/vendors.routes.js's PUT /me/payout-account,
     which now resolves server-side instead of trusting a client-typed
     accountName.

   No SDK: Paystack's own docs recommend plain REST, and this app
   already reaches for a raw fetch() over adding a dependency for a
   two-endpoint need (same reasoning as not pulling in an SDK for
   Cloudinary's plain upload endpoint elsewhere... except Cloudinary's
   SDK does more than that, so it stays; this genuinely doesn't).
   ========================================================= */

const PAYSTACK_BASE = "https://api.paystack.co";

function requireKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error("Bank verification isn't configured on this deployment yet, PAYSTACK_SECRET_KEY is unset.");
  }
  return key;
}

async function paystackGet(path) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    headers: { Authorization: `Bearer ${requireKey()}` },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body, data stays null, message below falls back */
  }
  if (!res.ok || !data?.status) {
    throw new Error(data?.message || `Paystack request failed (${res.status}).`);
  }
  return data.data;
}

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

module.exports = { listBanks, resolveAccountNumber };
