/* =========================================================
   Identifiers: the things that point at a real person behind an
   account (email, phone, device, NIN/BVN/licence, CAC number, payout
   bank account, payment card). Recorded for every account as it signs
   up, verifies, adds a bank account or pays (user_identifiers), and
   checked against banned_identifiers (utils/bans.js) wherever a banned
   person could come back.

   Values are normalized first, so trivial variations still match
   ("Ada.Obi+shop@gmail.com" = "adaobi@gmail.com", "0803 123 4567" =
   "+2348031234567"), then stored only as an HMAC keyed with
   ENCRYPTION_KEY: the tables can be compared but never read back.
   ========================================================= */

const crypto = require("crypto");
const pool = require("../db");
const { decrypt } = require("./encryption");

const KINDS = ["email", "phone", "device", "nin", "bvn", "drivers_license", "cac", "bank_account", "card"];

function normalize(kind, raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  switch (kind) {
    case "email": {
      const lower = value.toLowerCase();
      const at = lower.lastIndexOf("@");
      if (at < 1) return null;
      let local = lower.slice(0, at).split("+")[0];
      let domain = lower.slice(at + 1);
      // Gmail ignores dots and treats googlemail.com as the same inbox.
      if (domain === "gmail.com" || domain === "googlemail.com") {
        local = local.replace(/\./g, "");
        domain = "gmail.com";
      }
      if (domain.endsWith(".deleted")) return null;
      return local ? `${local}@${domain}` : null;
    }
    case "phone": {
      let digits = value.replace(/\D/g, "");
      if (digits.startsWith("234")) digits = digits.slice(3);
      if (digits.startsWith("0")) digits = digits.slice(1);
      return digits.length >= 10 ? digits.slice(-10) : null;
    }
    case "nin":
    case "bvn":
    case "drivers_license":
    case "cac":
      return value.toUpperCase().replace(/[\s-]/g, "") || null;
    case "bank_account":
      // "<bank code>:<account number>"
      return value.replace(/\s/g, "") || null;
    case "device":
    case "card":
      return value;
    default:
      return null;
  }
}

function hashIdentifier(kind, raw) {
  const normalized = normalize(kind, raw);
  if (!normalized) return null;
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY must be set to hash identifiers.");
  return crypto.createHmac("sha256", key).update(`${kind}:${normalized}`).digest("hex");
}

/** Records one identifier for an account. Never throws: bookkeeping must not break the action it rides on. */
async function recordIdentifier(userId, kind, raw) {
  try {
    const hash = hashIdentifier(kind, raw);
    if (!userId || !hash) return;
    await pool.query(
      `INSERT IGNORE INTO user_identifiers (user_id, kind, value_hash) VALUES (?, ?, ?)`,
      [userId, kind, hash]
    );
  } catch (err) {
    console.error(`Could not record ${kind} identifier:`, err.message);
  }
}

/**
 * The ban (user_bans row joined with the banned user) an identifier
 * belongs to, or null. `items` is [[kind, rawValue], ...]; the first
 * match wins.
 */
async function findBannedIdentifier(items) {
  for (const [kind, raw] of items) {
    let hash;
    try {
      hash = hashIdentifier(kind, raw);
    } catch {
      return null;
    }
    if (!hash) continue;
    const [[row]] = await pool.query(
      `SELECT b.id AS ban_id, b.user_id, bi.kind
       FROM banned_identifiers bi JOIN user_bans b ON b.id = bi.ban_id
       WHERE bi.kind = ? AND bi.value_hash = ? AND b.lifted_at IS NULL`,
      [kind, hash]
    );
    if (row) return row;
  }
  return null;
}

/**
 * Re-reads everything currently on file for an account (profile, KYC,
 * payout account, devices, past payment cards) into user_identifiers.
 * Run before a ban, so it covers what the account holds right now, and
 * by scripts/backfill-identifiers.js for accounts that predate this.
 */
async function collectIdentifiers(userId) {
  const [[user]] = await pool.query(
    `SELECT id, email, phone, payout_bank_code, payout_account_number_enc FROM users WHERE id = ?`,
    [userId]
  );
  if (!user) return;
  await recordIdentifier(userId, "email", user.email);
  await recordIdentifier(userId, "phone", user.phone);
  if (user.payout_bank_code && user.payout_account_number_enc) {
    try {
      await recordIdentifier(userId, "bank_account", `${user.payout_bank_code}:${decrypt(user.payout_account_number_enc)}`);
    } catch {
      /* undecryptable (key rotated), nothing to record */
    }
  }
  const [[kyc]] = await pool.query(
    `SELECT identity_type, identity_number_enc, cac_number FROM vendor_kyc WHERE vendor_id = ?`,
    [userId]
  );
  if (kyc?.identity_type && kyc.identity_number_enc) {
    try {
      await recordIdentifier(userId, kyc.identity_type, decrypt(kyc.identity_number_enc));
    } catch {
      /* undecryptable, skip */
    }
  }
  if (kyc?.cac_number) await recordIdentifier(userId, "cac", kyc.cac_number);
  const [devices] = await pool.query(`SELECT device_id FROM user_devices WHERE user_id = ?`, [userId]);
  for (const d of devices) await recordIdentifier(userId, "device", d.device_id);
  const [cards] = await pool.query(
    `SELECT DISTINCT card_signature FROM payments WHERE buyer_id = ? AND card_signature IS NOT NULL`,
    [userId]
  );
  for (const c of cards) await recordIdentifier(userId, "card", c.card_signature);
}

/** Other accounts sharing any identifier with this one: [{ id, name, email, role, status, sharedKinds: [...] }]. */
async function linkedAccounts(userId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.status, GROUP_CONCAT(DISTINCT other.kind) AS kinds
     FROM user_identifiers mine
     JOIN user_identifiers other ON other.kind = mine.kind AND other.value_hash = mine.value_hash AND other.user_id <> mine.user_id
     JOIN users u ON u.id = other.user_id
     WHERE mine.user_id = ?
     GROUP BY u.id, u.name, u.email, u.role, u.status
     ORDER BY u.name
     LIMIT 50`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    status: r.status,
    sharedKinds: String(r.kinds || "").split(",").filter(Boolean),
  }));
}

module.exports = { KINDS, normalize, hashIdentifier, recordIdentifier, findBannedIdentifier, collectIdentifiers, linkedAccounts };
