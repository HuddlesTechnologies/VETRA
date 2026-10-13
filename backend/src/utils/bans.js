/* =========================================================
   Permanent bans. banUser() marks the account 'banned', signs it out
   everywhere, delists a vendor's products, and copies every identifier
   the account holds (utils/identifiers.js) into banned_identifiers, so
   the same person is turned away at:
     - every API request, by device       (middleware/deviceBan.js)
     - signup and Google signup, by email, phone and device
     - profile email/phone changes
     - KYC, by NIN/BVN/licence (a match bans the new account too) and CAC
     - payout account setup, by bank account
     - checkout, by card                   (utils/payments.js, refunded)
   liftBan() undoes all of it, restoring the account's previous status.
   ========================================================= */

const pool = require("../db");
const { newId } = require("./id");
const { logActivity } = require("./activityLog");
const { escapeHtml } = require("./escapeHtml");
const { sendEmail } = require("./mailer");
const { collectIdentifiers } = require("./identifiers");
const { invalidateBanCache } = require("./devices");

// Identifiers that prove it's the same person, so a match on a new
// account bans that account as well rather than just refusing the step.
const IDENTITY_KINDS = ["nin", "bvn", "drivers_license"];

const TARGET_TYPE = { buyer: "customer", vendor: "vendor", rider: "rider" };

// Shown to someone a ban turns away. Deliberately vague about which
// detail matched, so it can't be used to probe the blocklist.
const BLOCKED_MESSAGE = "We can't continue with these details. If you think this is a mistake, contact support@vetrahq.org.";

async function activeBan(userId) {
  const [[ban]] = await pool.query(
    `SELECT * FROM user_bans WHERE user_id = ? AND lifted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return ban || null;
}

async function banUser({ userId, adminId = null, reason = null, matchedBanId = null }) {
  const [[user]] = await pool.query(`SELECT id, name, email, role, status FROM users WHERE id = ?`, [userId]);
  if (!user) throw Object.assign(new Error("Account not found."), { status: 404 });
  if (user.role === "admin") throw Object.assign(new Error("Admin accounts can't be banned."), { status: 400 });
  if (user.status === "deleted") throw Object.assign(new Error("This account is already deleted."), { status: 400 });
  const existing = await activeBan(userId);
  if (existing) return existing.id;

  await collectIdentifiers(userId);

  const banId = newId();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let delisted = [];
    if (user.role === "vendor") {
      const [listed] = await conn.query(`SELECT id FROM products WHERE vendor_id = ? AND status <> 'removed'`, [userId]);
      delisted = listed.map((p) => p.id);
    }
    await conn.query(
      `INSERT INTO user_bans (id, user_id, reason, banned_by_user_id, matched_ban_id, previous_status, delisted_product_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [banId, userId, reason ? String(reason).slice(0, 255) : null, adminId, matchedBanId, user.status, JSON.stringify(delisted)]
    );
    // An identifier already on another active ban stays with that one.
    await conn.query(
      `INSERT IGNORE INTO banned_identifiers (kind, value_hash, ban_id)
       SELECT kind, value_hash, ? FROM user_identifiers WHERE user_id = ?`,
      [banId, userId]
    );
    await conn.query(
      `UPDATE users SET status = 'banned', session_version = session_version + 1, rider_on_duty = FALSE WHERE id = ?`,
      [userId]
    );
    if (delisted.length) {
      // Out of the catalog now; liftBan() relists exactly these.
      await conn.query(`UPDATE products SET status = 'removed' WHERE id IN (?)`, [delisted]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  invalidateBanCache();

  await logActivity({
    type: "ban",
    message: matchedBanId
      ? `Automatically banned <strong>${escapeHtml(user.name)}</strong>: their ID matches a banned account.`
      : `Permanently banned <strong>${escapeHtml(user.name)}</strong>${reason ? `, ${escapeHtml(reason)}` : ""}.`,
    actorUserId: adminId,
    targetType: TARGET_TYPE[user.role] || "customer",
    targetId: userId,
  });
  if (!matchedBanId) {
    await sendEmail({
      to: user.email,
      subject: "Your VETRA account has been permanently banned",
      html: `<p>Hi ${escapeHtml(user.name)},</p><p>Your VETRA account has been permanently banned${reason ? ` for the following reason: ${escapeHtml(reason)}` : ""}. You can no longer sign in or use VETRA, and new accounts can't be opened with your details.</p><p>If you think this is a mistake, reply to this email or contact support@vetrahq.org.</p>`,
      logFallback: `ban email for ${user.email}`,
    });
  }
  return banId;
}

async function liftBan({ userId, adminId }) {
  const ban = await activeBan(userId);
  if (!ban) throw Object.assign(new Error("This account isn't banned."), { status: 404 });
  const [[user]] = await pool.query(`SELECT id, name, email, role FROM users WHERE id = ?`, [userId]);
  const restoreStatus = ["active", "suspended", "pending", "rejected"].includes(ban.previous_status) ? ban.previous_status : "active";

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE user_bans SET lifted_at = NOW(), lifted_by_user_id = ? WHERE id = ?`, [adminId, ban.id]);
    await conn.query(`DELETE FROM banned_identifiers WHERE ban_id = ?`, [ban.id]);
    await conn.query(`UPDATE users SET status = ? WHERE id = ? AND status = 'banned'`, [restoreStatus, userId]);
    const raw = ban.delisted_product_ids;
    const delisted = (typeof raw === "string" ? JSON.parse(raw) : raw) || [];
    if (delisted.length) {
      await conn.query(
        `UPDATE products SET status = IF(stock_quantity > 0, 'active', 'out_of_stock') WHERE id IN (?) AND status = 'removed'`,
        [delisted]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  invalidateBanCache();

  await logActivity({
    type: "ban",
    message: `Lifted the ban on <strong>${escapeHtml(user.name)}</strong>.`,
    actorUserId: adminId,
    targetType: TARGET_TYPE[user.role] || "customer",
    targetId: userId,
  });
  await sendEmail({
    to: user.email,
    subject: "Your VETRA account ban has been lifted",
    html: `<p>Hi ${escapeHtml(user.name)},</p><p>The ban on your VETRA account has been lifted. You can sign in again.</p>`,
    logFallback: `ban lifted email for ${user.email}`,
  });
}

module.exports = { IDENTITY_KINDS, BLOCKED_MESSAGE, activeBan, banUser, liftBan };
