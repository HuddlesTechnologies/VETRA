/* =========================================================
   /api/admin — the real backend behind admin/assets/data.js's
   VetraAdmin.* functions (see BACKEND_GUIDE.md §5's mapping
   table). Every route here is admin-only; role-scoped visibility
   (Super Admin vs Moderator/Support on the activity feed) is
   enforced here, server-side — the prototype only ever did this
   in the browser, which BACKEND_GUIDE.md §6 point 1 flags as not
   a real security boundary.
   ========================================================= */

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { newId } = require("../utils/id");
const { hashPassword } = require("../utils/password");
const { requireAuth, requireRole, requireAdminRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");
const { escapeHtml } = require("../utils/escapeHtml");
const { notify } = require("../utils/notify");
const { ORDER_ITEMS_SUBQUERY } = require("../utils/orderItemsSubquery");
const { sendEmail } = require("../utils/mailer");
const { decrypt } = require("../utils/encryption");

// Base URL for links inside emails (reset-password, admin invite) — the
// backend has no other way to know where the frontend is actually
// served from. Defaults to the known Vercel deployment so this works
// with zero extra config; override via env if that ever changes.
const FRONTEND_URL = process.env.FRONTEND_URL || "https://vetra-vercel.vercel.app";

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// Shared by the customer and vendor reset-password routes below — an
// admin triggers this, but only the account holder ever sees the
// resulting credential (BACKEND_GUIDE.md §6 point 2). Generates a raw
// token, stores only its SHA-256 hash (see password_reset_tokens in
// migrations/001_init.sql), and emails a link containing the raw
// token to reset-password.html.
async function createAndEmailPasswordReset(user) {
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await pool.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    [newId(), user.id, tokenHash, expiresAt]
  );

  const resetUrl = `${FRONTEND_URL}/reset-password.html?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your VETRA password",
    html: `<p>Hi ${user.name},</p><p>An admin requested a password reset for your VETRA account. Click below to set a new password — this link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't expect this, you can ignore this email.</p>`,
    logFallback: `password reset for ${user.email}: ${resetUrl}`,
  });
}

// ---------- Customers ----------
router.get(
  "/customers",
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    const clauses = ["role = 'buyer'", "status <> 'deleted'"];
    const params = [];
    if (q) {
      clauses.push("(name LIKE ? OR email LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    // order_count/total_spent power admin/customers.html's table columns —
    // real aggregates over that customer's own orders, not stored counters.
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.address, u.status, u.signup_method, u.last_login_at, u.last_login_ip, u.created_at,
              (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id) AS order_count,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.buyer_id = u.id AND o.status = 'completed') AS total_spent
       FROM users u WHERE ${clauses.join(" AND ")} ORDER BY u.created_at DESC LIMIT 200`, // safety-net cap, not real pagination
      params
    );
    res.json(rows);
  })
);

router.get(
  "/customers/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.address, u.status, u.signup_method, u.last_login_at, u.last_login_ip, u.created_at,
              (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id) AS order_count,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.buyer_id = u.id AND o.status = 'completed') AS total_spent
       FROM users u WHERE u.id = ? AND u.role = 'buyer'`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Customer not found." });
    res.json(rows[0]);
  })
);

// A customer's own order history (admin/customer-detail.html's Orders
// section) — same item-summary shape as GET /api/orders/mine, just
// queryable by an admin for any customer instead of "my own orders".
router.get(
  "/customers/:id/orders",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT o.*, u.store_name AS vendor_name, ${ORDER_ITEMS_SUBQUERY} AS items
       FROM orders o JOIN users u ON u.id = o.vendor_id
       WHERE o.buyer_id = ? ORDER BY o.created_at DESC LIMIT 200`, // safety-net cap, not real pagination
      [req.params.id]
    );
    res.json(rows);
  })
);

router.patch(
  "/customers/:id/status",
  // A suspend/reactivate call is a moderation decision, not a front-line
  // support task — Support can reset a password but not this. See
  // BACKEND_GUIDE.md §4 point 6's role matrix.
  requireAdminRole("Super Admin", "Moderator"),
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body;
    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'suspended'." });
    }

    const [rows] = await pool.query(`SELECT name FROM users WHERE id = ? AND role = 'buyer'`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Customer not found." });

    await pool.query(`UPDATE users SET status = ?, session_version = session_version + 1 WHERE id = ?`, [status, req.params.id]);
    await logActivity({
      type: "account",
      message: `${status === "suspended" ? "Suspended" : "Reactivated"} customer <strong>${escapeHtml(rows[0].name)}</strong>${reason ? ` — ${escapeHtml(reason)}` : ""}.`,
      actorUserId: req.user.id,
      targetType: "customer",
      targetId: req.params.id,
    });
    await notify({
      userId: req.params.id,
      type: "account",
      title: status === "suspended" ? "Account suspended" : "Account reactivated",
      message: status === "suspended"
        ? `Your account has been suspended.${reason ? ` Reason: ${escapeHtml(reason)}` : " Contact support for details."}`
        : "Your account has been reactivated — welcome back.",
      link: "settings.html",
    });
    res.json({ ok: true });
  })
);

router.delete(
  "/customers/:id",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT name FROM users WHERE id = ? AND role = 'buyer'`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Customer not found." });

    const placeholderEmail = `deleted-${req.params.id}@vetra.deleted`;
    const randomPasswordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
    await pool.query(
      `UPDATE users SET
         status = 'deleted', name = 'Deleted User', email = ?, password_hash = ?,
         phone = NULL, address = NULL, avatar_url = NULL,
         store_name = NULL, store_description = NULL, store_cover_url = NULL,
         payout_bank_name = NULL, payout_bank_code = NULL,
         payout_account_number_enc = NULL, payout_account_name = NULL
       WHERE id = ? AND role = 'buyer'`,
      [placeholderEmail, randomPasswordHash, req.params.id]
    );
    await logActivity({
      type: "account",
      message: `Deleted customer account <strong>${escapeHtml(rows[0].name)}</strong>.`,
      actorUserId: req.user.id,
      targetType: "customer",
      targetId: req.params.id,
    });
    res.json({ ok: true });
  })
);

router.post(
  "/customers/:id/reset-password",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT id, name, email FROM users WHERE id = ? AND role = 'buyer'`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Customer not found." });

    await createAndEmailPasswordReset(rows[0]);
    await logActivity({
      type: "account",
      message: `Password reset requested for customer.`,
      actorUserId: req.user.id,
      targetType: "customer",
      targetId: req.params.id,
    });
    res.json({ ok: true, message: "Reset link sent to the account holder." });
  })
);

// ---------- Vendors ----------
router.get(
  "/vendors",
  asyncHandler(async (req, res) => {
    const { status, kycStatus } = req.query;
    const clauses = ["u.role = 'vendor'", "u.status <> 'deleted'"];
    const params = [];
    if (status && status !== "all") {
      clauses.push("u.status = ?");
      params.push(status);
    }
    if (kycStatus && kycStatus !== "all") {
      clauses.push("vk.status = ?");
      params.push(kycStatus);
    }
    // products_count/orders_count/revenue power admin/vendors.html's table
    // columns — real aggregates, same reasoning as the customers route above.
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.address, u.store_name, u.store_category, u.status, u.last_login_at, u.last_login_ip, u.created_at,
              (SELECT COUNT(*) FROM products p WHERE p.vendor_id = u.id AND p.status = 'active') AS products_count,
              (SELECT COUNT(*) FROM orders o WHERE o.vendor_id = u.id) AS orders_count,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.vendor_id = u.id AND o.status = 'completed') AS revenue,
              COALESCE(vk.submitted_at IS NOT NULL AND vk.id_document_url IS NOT NULL AND vk.cac_document_url IS NOT NULL, 0) AS kyc_documents_submitted,
              vk.status AS kyc_status,
              CASE
                WHEN vk.identity_provider_status <> 'verified' THEN vk.identity_provider_message
                WHEN vk.cac_provider_status <> 'verified' THEN vk.cac_provider_message
                ELSE 'Provider verification failed.'
              END AS kyc_provider_reason
            FROM users u LEFT JOIN vendor_kyc vk ON vk.vendor_id = u.id
            WHERE ${clauses.join(" AND ")} ORDER BY u.created_at DESC LIMIT 200`, // safety-net cap, not real pagination
      params
    );
    res.json(rows);
  })
);

// products_count/orders_count/revenue: same aggregates as the list route.
// kyc: the vendor's own KYC submission (null if never submitted) — powers
// admin/vendor-detail.html's Business Verification section. There's no
// stored document filename in vendor_kyc (only the uploaded URL), so
// kyc_id_document_url/kyc_cac_document_url are the only doc fields —
// the frontend labels them generically ("ID Document"/"CAC Certificate")
// rather than a real filename that was never captured.
router.get(
  "/vendors/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.address, u.store_name, u.store_category, u.store_description,
              u.status, u.last_login_at, u.last_login_ip, u.created_at,
              (SELECT COUNT(*) FROM products p WHERE p.vendor_id = u.id AND p.status = 'active') AS products_count,
              (SELECT COUNT(*) FROM orders o WHERE o.vendor_id = u.id) AS orders_count,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.vendor_id = u.id AND o.status = 'completed') AS revenue,
              vk.status AS kyc_status, vk.cac_number AS kyc_cac_number,
              vk.identity_type AS kyc_identity_type,
              vk.identity_provider_status AS kyc_identity_provider_status,
              vk.identity_provider_message AS kyc_identity_provider_message,
              vk.identity_verified_at AS kyc_identity_verified_at,
              vk.cac_provider_status AS kyc_cac_provider_status,
              vk.cac_provider_message AS kyc_cac_provider_message,
              vk.cac_verified_at AS kyc_cac_verified_at,
              vk.id_document_url AS kyc_id_document_url, vk.cac_document_url AS kyc_cac_document_url,
              vk.submitted_at AS kyc_submitted_at, vk.reviewed_at AS kyc_reviewed_at,
              vk.rejection_reason AS kyc_rejection_reason
       FROM users u LEFT JOIN vendor_kyc vk ON vk.vendor_id = u.id
       WHERE u.id = ? AND u.role = 'vendor'`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Vendor not found." });
    res.json(rows[0]);
  })
);

router.get(
  "/vendors/:id/payout-account",
  requireAdminRole("Super Admin", "Moderator"),
  asyncHandler(async (req, res) => {
    const [[vendor]] = await pool.query(
      `SELECT payout_bank_name, payout_bank_code, payout_account_number_enc, payout_account_name
       FROM users WHERE id = ? AND role = 'vendor'`,
      [req.params.id]
    );
    if (!vendor) return res.status(404).json({ error: "Vendor not found." });

    const [history] = await pool.query(
      `SELECT bank_name, bank_code, account_name, masked_account_number, linked_at, unlinked_at
       FROM vendor_payout_account_history WHERE vendor_id = ? ORDER BY linked_at DESC LIMIT 100`,
      [req.params.id]
    );
    const current = vendor.payout_account_number_enc
      ? {
          bankName: vendor.payout_bank_name,
          bankCode: vendor.payout_bank_code,
          accountName: vendor.payout_account_name,
          maskedAccountNumber: `•••• ${decrypt(vendor.payout_account_number_enc).slice(-4)}`,
        }
      : null;
    res.json({ current, history });
  })
);

router.get(
  "/users/:id/ip-history",
  asyncHandler(async (req, res) => {
    const [[user]] = await pool.query(
      `SELECT id FROM users WHERE id = ? AND role IN ('buyer', 'vendor')`,
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: "User not found." });
    const [rows] = await pool.query(
      `SELECT ip_address, occurred_at FROM login_ip_history WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(rows);
  })
);

// A vendor's own order history (admin/vendor-detail.html's Orders section)
// — same item-summary shape as GET /api/orders/vendor.
router.get(
  "/vendors/:id/orders",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT o.*, COALESCE(u.name, o.guest_name) AS buyer_name, ${ORDER_ITEMS_SUBQUERY} AS items
       FROM orders o LEFT JOIN users u ON u.id = o.buyer_id
       WHERE o.vendor_id = ? ORDER BY o.created_at DESC LIMIT 200`, // safety-net cap, not real pagination
      [req.params.id]
    );
    res.json(rows);
  })
);

// Full vendor catalog for admin review. Includes removed listings so the
// console remains an audit view rather than silently losing product history.
router.get(
  "/vendors/:id/products",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT p.id, p.vendor_id, p.name, p.category, p.color, p.storage, p.price,
              p.stock_quantity, p.description, p.keywords, p.images, p.video_url,
              p.status, p.created_at, p.updated_at
       FROM products p
       JOIN users u ON u.id = p.vendor_id
       WHERE p.vendor_id = ? AND u.role = 'vendor'
       ORDER BY p.created_at DESC LIMIT 200`,
      [req.params.id]
    );
    res.json(rows);
  })
);

router.delete(
  "/vendors/:vendorId/products/:productId",
  requireAdminRole("Super Admin", "Moderator"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT p.name, p.status, u.store_name, u.email
       FROM products p JOIN users u ON u.id = p.vendor_id
       WHERE p.id = ? AND p.vendor_id = ? AND u.role = 'vendor'`,
      [req.params.productId, req.params.vendorId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Vendor listing not found." });
    if (rows[0].status === "removed") return res.status(400).json({ error: "This listing has already been removed." });

    await pool.query(`UPDATE products SET status = 'removed' WHERE id = ?`, [req.params.productId]);
    await logActivity({
      type: "vendor",
      message: `Removed listing <strong>${escapeHtml(rows[0].name)}</strong> from <strong>${escapeHtml(rows[0].store_name)}</strong>.`,
      actorUserId: req.user.id,
      targetType: "vendor",
      targetId: req.params.vendorId,
    });
    await notify({
      userId: req.params.vendorId,
      type: "account",
      title: "Listing removed",
      message: `Your listing "${escapeHtml(rows[0].name)}" was removed from your store by a VETRA moderator. Contact support if you believe this was a mistake.`,
      link: "products.html",
    });
    await sendEmail({
      to: rows[0].email,
      subject: `Your VETRA listing was removed: ${rows[0].name}`,
      html: `<p>Hi,</p><p>Your listing <strong>${escapeHtml(rows[0].name)}</strong> has been removed from <strong>${escapeHtml(rows[0].store_name)}</strong> by a VETRA moderator.</p><p>The listing is no longer visible to buyers. If you believe this was a mistake, please contact VETRA support.</p>`,
      logFallback: `listing removal notice for ${rows[0].email}: ${rows[0].name} (${rows[0].store_name})`,
    });
    res.json({ ok: true });
  })
);

router.patch(
  "/vendors/:id/status",
  requireAdminRole("Super Admin", "Moderator"),
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body;
    if (!["active", "suspended", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be 'active', 'suspended', or 'rejected'." });
    }

    const [rows] = await pool.query(`SELECT store_name, status AS current_status FROM users WHERE id = ? AND role = 'vendor'`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Vendor not found." });

    // "Require ID/business verification for new vendors" only gates a
    // genuine approval (pending -> active) — a vendor being reactivated
    // after a suspension already cleared this bar once, so it doesn't
    // apply again there.
    if (status === "active" && rows[0].current_status === "pending") {
      const [settingsRows] = await pool.query(`SELECT vendor_verification_required FROM platform_settings WHERE id = 1`);
      if (settingsRows[0]?.vendor_verification_required) {
        const [kycRows] = await pool.query(`SELECT status FROM vendor_kyc WHERE vendor_id = ?`, [req.params.id]);
        if (kycRows[0]?.status !== "verified") {
          return res.status(400).json({ error: "This vendor's business verification (KYC) must be approved before they can be approved to sell." });
        }
      }
    }

    await pool.query(`UPDATE users SET status = ?, session_version = session_version + 1 WHERE id = ?`, [status, req.params.id]);
    const verb = { active: "Approved", suspended: "Suspended", rejected: "Rejected" }[status];
    await logActivity({
      type: "vendor",
      message: `${verb} vendor <strong>${escapeHtml(rows[0].store_name)}</strong>${reason ? ` — ${escapeHtml(reason)}` : ""}.`,
      actorUserId: req.user.id,
      targetType: "vendor",
      targetId: req.params.id,
    });
    const notifyText = {
      active: "Your store application has been approved — you're live on VETRA.",
      suspended: `Your store has been suspended.${reason ? ` Reason: ${escapeHtml(reason)}` : " Contact support for details."}`,
      rejected: `Your store application was rejected.${reason ? ` Reason: ${escapeHtml(reason)}` : ""}`,
    }[status];
    await notify({
      userId: req.params.id,
      type: "vendor_status",
      title: `${verb} — your store`,
      message: notifyText,
      link: "profile.html",
    });
    res.json({ ok: true });
  })
);

router.delete(
  "/vendors/:id",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT name, store_name FROM users WHERE id = ? AND role = 'vendor'`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Vendor not found." });

    const placeholderEmail = `deleted-${req.params.id}@vetra.deleted`;
    const randomPasswordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE users SET
           status = 'deleted', name = 'Deleted User', email = ?, password_hash = ?,
           phone = NULL, address = NULL, avatar_url = NULL,
           store_name = 'Deleted Store', store_description = NULL, store_cover_url = NULL,
           payout_bank_name = NULL, payout_bank_code = NULL,
           payout_account_number_enc = NULL, payout_account_name = NULL
         WHERE id = ? AND role = 'vendor'`,
        [placeholderEmail, randomPasswordHash, req.params.id]
      );
      await connection.query(`UPDATE products SET status = 'removed' WHERE vendor_id = ?`, [req.params.id]);
      await connection.query(`UPDATE vendor_kyc SET reviewed_by_user_id = NULL WHERE reviewed_by_user_id = ?`, [req.params.id]);
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    await logActivity({
      type: "account",
      message: `Deleted vendor account <strong>${escapeHtml(rows[0].store_name || rows[0].name)}</strong>.`,
      actorUserId: req.user.id,
      targetType: "vendor",
      targetId: req.params.id,
    });
    res.json({ ok: true });
  })
);

router.post(
  "/vendors/:id/reset-password",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT id, name, email FROM users WHERE id = ? AND role = 'vendor'`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Vendor not found." });

    await createAndEmailPasswordReset(rows[0]);
    await logActivity({
      type: "account",
      message: `Password reset requested for vendor.`,
      actorUserId: req.user.id,
      targetType: "vendor",
      targetId: req.params.id,
    });
    res.json({ ok: true, message: "Reset link sent to the account holder." });
  })
);

// ---------- Vendor KYC review ----------
// Real version of VetraAdmin.setVendorKycStatus() — see
// BACKEND_GUIDE.md §5. Same role restriction as the status routes above:
// reviewing submitted business documents is a moderation decision.
router.patch(
  "/vendors/:id/kyc",
  requireAdminRole("Super Admin", "Moderator"),
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body;
    if (!["verified", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be 'verified' or 'rejected'." });
    }
    // A rejection with nothing explaining it isn't useful enough to
    // let through — this reason is what the vendor actually reads in
    // their rejection email below. Enforced here, not just by
    // admin/vendor-detail.js's own requireReason modal, since a client
    // check alone isn't a real guarantee.
    if (status === "rejected" && !reason?.trim()) {
      return res.status(400).json({ error: "A reason is required when rejecting a KYC submission." });
    }

    const [rows] = await pool.query(
      `SELECT vk.status, u.store_name, u.name, u.email FROM vendor_kyc vk
       JOIN users u ON u.id = vk.vendor_id
       WHERE vk.vendor_id = ?`,
      [req.params.id]
    );
    const kyc = rows[0];
    if (!kyc) return res.status(404).json({ error: "This vendor has no KYC submission on file." });
    if (!["pending", "manual_review"].includes(kyc.status)) {
      return res.status(400).json({ error: "This vendor has no KYC submission awaiting review." });
    }

    // rejection_reason is cleared unconditionally on a verify, so an old
    // rejection reason from a prior round can't linger and resurface
    // after a later approval.
    await pool.query(
      `UPDATE vendor_kyc SET status = ?, reviewed_at = NOW(), reviewed_by_user_id = ?, rejection_reason = ?
       WHERE vendor_id = ?`,
      [status, req.user.id, status === "rejected" ? reason || null : null, req.params.id]
    );

    const verb = status === "verified" ? "Verified" : "Rejected";
    await logActivity({
      type: "vendor",
      message: `${verb} KYC documents for <strong>${escapeHtml(kyc.store_name)}</strong>${reason ? ` — ${escapeHtml(reason)}` : ""}.`,
      actorUserId: req.user.id,
      targetType: "vendor",
      targetId: req.params.id,
    });
    await notify({
      userId: req.params.id,
      type: "kyc",
      title: status === "verified" ? "Business verification approved" : "Business verification rejected",
      message: status === "verified"
        ? "Your business documents are verified — buyers can now see your Verified Vendor badge."
        : `Your business documents were rejected.${reason ? ` Reason: ${escapeHtml(reason)}` : ""} Update and resubmit from your profile.`,
      link: "profile.html",
    });
    if (status === "verified") {
      await sendEmail({
        to: kyc.email,
        subject: "Your VETRA business verification is approved",
        html: `<p>Hi ${escapeHtml(kyc.name)},</p><p>Good news — <strong>${escapeHtml(kyc.store_name)}</strong>'s business verification (KYC) has been approved. Buyers can now see your Verified Vendor badge on your storefront.</p>`,
        logFallback: `KYC approval email for ${kyc.email} (${kyc.store_name})`,
      });
    } else {
      await sendEmail({
        to: kyc.email,
        subject: "Your VETRA business verification needs another look",
        html: `<p>Hi ${escapeHtml(kyc.name)},</p><p><strong>${escapeHtml(kyc.store_name)}</strong>'s business verification (KYC) documents were rejected.${reason ? ` Reason: ${escapeHtml(reason)}` : ""}</p><p>Update and resubmit your documents from your profile whenever you're ready.</p>`,
        logFallback: `KYC rejection email for ${kyc.email} (${kyc.store_name})${reason ? `: ${reason}` : ""}`,
      });
    }
    res.json({ ok: true });
  })
);

// ---------- Stats ----------
router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const [[{ totalCustomers }]] = await pool.query(
      `SELECT COUNT(*) AS totalCustomers FROM users WHERE role = 'buyer' AND status <> 'deleted'`
    );
    const [[{ totalVendors }]] = await pool.query(
      `SELECT COUNT(*) AS totalVendors FROM users WHERE role = 'vendor' AND status <> 'deleted'`
    );
    const [[{ suspendedAccounts }]] = await pool.query(
      `SELECT COUNT(*) AS suspendedAccounts FROM users WHERE status = 'suspended'`
    );
    // Broken out separately (not just the combined suspendedAccounts above)
    // for admin/dashboard.html's per-card sub-labels.
    const [[{ suspendedCustomers }]] = await pool.query(
      `SELECT COUNT(*) AS suspendedCustomers FROM users WHERE role = 'buyer' AND status = 'suspended'`
    );
    const [[{ suspendedVendors }]] = await pool.query(
      `SELECT COUNT(*) AS suspendedVendors FROM users WHERE role = 'vendor' AND status = 'suspended'`
    );
    const [[{ pendingVendors }]] = await pool.query(
      `SELECT COUNT(*) AS pendingVendors FROM users WHERE role = 'vendor' AND status = 'pending'`
    );
    const [[{ openReports }]] = await pool.query(`SELECT COUNT(*) AS openReports FROM reports WHERE status = 'open'`);
    const [[{ kycManualReview }]] = await pool.query(
      `SELECT COUNT(*) AS kycManualReview FROM vendor_kyc WHERE status = 'manual_review'`
    );
    const [[{ platformOrders }]] = await pool.query(`SELECT COUNT(*) AS platformOrders FROM orders`);
    const [[{ platformRevenue }]] = await pool.query(
      `SELECT COALESCE(SUM(total), 0) AS platformRevenue FROM orders WHERE status = 'completed'`
    );
    res.json({
      totalCustomers, totalVendors, suspendedAccounts, suspendedCustomers, suspendedVendors,
      pendingVendors, openReports, platformOrders, platformRevenue,
      kycManualReview,
    });
  })
);

// ---------- Activity log ----------
// Role-scoped server-side: a Super Admin sees everything; a Moderator/
// Support admin sees platform events (actor_user_id IS NULL) plus their
// own actions only. Matches VetraAdmin.getVisibleActivity()'s intent,
// but as a real permission boundary instead of a client-side filter.
router.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const isSuperAdmin = req.user.adminRole === "Super Admin";
    const { adminId, targetType, targetId } = req.query; // adminId: Super Admin only

    const clauses = [];
    const params = [];
    if (!isSuperAdmin) {
      clauses.push("(actor_user_id IS NULL OR actor_user_id = ?)");
      params.push(req.user.id);
    } else if (adminId) {
      clauses.push("actor_user_id = ?");
      params.push(adminId);
    }
    // Scopes the feed to one customer/vendor's own history — admin/
    // customer-detail.html and vendor-detail.html — on top of (not instead
    // of) the role-scoping above, so a Moderator viewing this still only
    // sees platform events + their own actions about that account.
    if (targetType && targetId) {
      clauses.push("target_type = ? AND target_id = ?");
      params.push(targetType, targetId);
    }
    const where = clauses.length ? clauses.join(" AND ") : "1=1";

    const [rows] = await pool.query(
      `SELECT a.*, u.name AS actor_name
       FROM activity_log a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ${where} ORDER BY a.created_at DESC LIMIT 200`,
      params
    );
    res.json(rows);
  })
);

// Pruning the audit trail is itself sensitive enough that it's kept to
// Super Admin only (not Moderator, unlike most of this route's own
// view access) — same tier as managing the admin team, since deleting
// the record of what happened is a bigger deal than viewing it.
// Deliberately does NOT write a fresh activity row documenting the
// deletion — clearing the log is meant to actually clear it, not leave
// a new trace behind every time.
router.delete(
  "/activity/:id",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(`DELETE FROM activity_log WHERE id = ?`, [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Activity entry not found." });
    res.json({ ok: true });
  })
);

router.delete(
  "/activity",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    await pool.query(`DELETE FROM activity_log`);
    res.json({ ok: true });
  })
);

// ---------- Admin team ----------
router.get(
  "/team",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, email, admin_role, avatar_url FROM users WHERE role = 'admin' ORDER BY created_at ASC`
    );
    res.json(rows);
  })
);

// Promote/demote an existing team member between the three admin_role
// values. Same "can't leave the platform with zero Super Admins" guard
// as removal below — only blocks moving the *last* Super Admin down,
// not any other transition (including a Super Admin demoting
// themself, as long as another Super Admin still exists).
router.patch(
  "/team/:id",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const { adminRole } = req.body;
    if (!["Super Admin", "Moderator", "Support"].includes(adminRole)) {
      return res.status(400).json({ error: "adminRole must be 'Super Admin', 'Moderator', or 'Support'." });
    }

    const [target] = await pool.query(`SELECT name, email, admin_role FROM users WHERE id = ? AND role = 'admin'`, [req.params.id]);
    if (!target[0]) return res.status(404).json({ error: "Admin not found." });

    if (target[0].admin_role === adminRole) {
      return res.json({ ok: true, adminRole }); // no-op, nothing to change
    }

    if (target[0].admin_role === "Super Admin" && adminRole !== "Super Admin") {
      const [[{ superAdminCount }]] = await pool.query(
        `SELECT COUNT(*) AS superAdminCount FROM users WHERE role = 'admin' AND admin_role = 'Super Admin'`
      );
      if (superAdminCount <= 1) {
        return res.status(400).json({ error: "Can't change the platform's last Super Admin to a different role." });
      }
    }

    await pool.query(`UPDATE users SET admin_role = ?, session_version = session_version + 1 WHERE id = ?`, [adminRole, req.params.id]);
    await logActivity({
      type: "account",
      message: `Changed <strong>${escapeHtml(target[0].name)}</strong>'s admin role from ${target[0].admin_role} to <strong>${adminRole}</strong>.`,
      actorUserId: req.user.id,
      targetType: "admin",
      targetId: req.params.id,
    });

    await sendEmail({
      to: target[0].email,
      subject: "Your VETRA admin role has changed",
      html: `<p>Hi ${target[0].name},</p><p>Your VETRA admin role has been changed from <strong>${target[0].admin_role}</strong> to <strong>${adminRole}</strong>, effective immediately.</p><p>If this wasn't expected, contact your platform administrator.</p>`,
      logFallback: `admin role-change notice for ${target[0].email}: ${target[0].admin_role} -> ${adminRole}`,
    });

    res.json({ ok: true, adminRole });
  })
);

router.delete(
  "/team/:id",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const [[{ superAdminCount }]] = await pool.query(
      `SELECT COUNT(*) AS superAdminCount FROM users WHERE role = 'admin' AND admin_role = 'Super Admin'`
    );
    const [target] = await pool.query(`SELECT name, email, admin_role FROM users WHERE id = ? AND role = 'admin'`, [req.params.id]);
    if (!target[0]) return res.status(404).json({ error: "Admin not found." });
    if (target[0].admin_role === "Super Admin" && superAdminCount <= 1) {
      return res.status(400).json({ error: "Can't remove the platform's last Super Admin." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // These nullable attribution fields may still point at an admin who
      // reviewed a report or KYC submission. Preserve the records, but clear
      // the attribution so the account can be removed cleanly.
      await connection.query(
        `UPDATE reports
         SET reporter_user_id = NULL, attended_by_user_id = NULL
         WHERE reporter_user_id = ? OR attended_by_user_id = ?`,
        [req.params.id, req.params.id]
      );
      await connection.query(
        `UPDATE vendor_kyc SET reviewed_by_user_id = NULL WHERE reviewed_by_user_id = ?`,
        [req.params.id]
      );
      await connection.query(`DELETE FROM users WHERE id = ?`, [req.params.id]);
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    await logActivity({
      type: "account",
      message: `Removed admin team member <strong>${escapeHtml(target[0].name)}</strong>.`,
      actorUserId: req.user.id,
    });

    await sendEmail({
      to: target[0].email,
      subject: "Your VETRA admin access has been removed",
      html: `<p>Hi ${target[0].name},</p><p>Your VETRA admin account has been removed from the team, effective immediately. You no longer have access to the admin console.</p><p>If this wasn't expected, contact your platform administrator.</p>`,
      logFallback: `admin removal notice for ${target[0].email}`,
    });

    res.json({ ok: true });
  })
);

// ---------- Admin invites ----------
router.get(
  "/invites",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, email, admin_role, created_at FROM admin_invites WHERE status = 'pending' ORDER BY created_at DESC`
    );
    res.json(rows);
  })
);

router.delete(
  "/invites/:id",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(
      `UPDATE admin_invites SET status = 'cancelled' WHERE id = ? AND status = 'pending'`,
      [req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Invite not found or already used." });
    res.json({ ok: true });
  })
);

// Real version of the simulated invite-and-verify flow: generates a code,
// hashes it before storing (never the raw code — see BACKEND_GUIDE.md §6
// point 3), and actually compares hashes on verify instead of accepting
// anything non-empty. Emailing the code is a TODO in the same place the
// password-reset routes above flag it.
router.post(
  "/invites",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const { name, email, adminRole } = req.body;
    if (!name || !email || !["Super Admin", "Moderator", "Support"].includes(adminRole)) {
      return res.status(400).json({ error: "name, email, and a valid adminRole are required." });
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const codeHash = await hashPassword(code);
    const id = newId();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await pool.query(
      `INSERT INTO admin_invites (id, name, email, admin_role, invited_by_user_id, verification_code_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, adminRole, req.user.id, codeHash, expiresAt]
    );

    await sendEmail({
      to: email,
      subject: "Your VETRA admin verification code",
      html: `<p>Hi ${name},</p><p>You've been invited to join the VETRA admin team as <strong>${adminRole}</strong>. Enter this code to finish setting up your account — it expires in 15 minutes.</p><p style="font-size:28px; font-weight:700; letter-spacing:4px;">${code}</p>`,
      logFallback: `admin invite for ${email}: code=${code}`,
    });
    res.status(201).json({ id });
  })
);

router.post(
  "/invites/:id/verify",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const { code } = req.body;
    const [rows] = await pool.query(`SELECT * FROM admin_invites WHERE id = ? AND status = 'pending'`, [req.params.id]);
    const invite = rows[0];
    if (!invite) return res.status(404).json({ error: "Invite not found or already used." });
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: "This code has expired." });
    }

    const matches = await bcrypt.compare(code || "", invite.verification_code_hash);
    if (!matches) return res.status(400).json({ error: "Incorrect code." });

    const tempPassword = crypto.randomBytes(9).toString("base64url");
    const passwordHash = await hashPassword(tempPassword);
    const userId = newId();

    await pool.query(
      `INSERT INTO users (id, role, name, email, password_hash, admin_role) VALUES (?, 'admin', ?, ?, ?, ?)`,
      [userId, invite.name, invite.email, passwordHash, invite.admin_role]
    );
    await pool.query(`UPDATE admin_invites SET status = 'verified' WHERE id = ?`, [req.params.id]);
    await logActivity({
      type: "account",
      message: `Added <strong>${escapeHtml(invite.name)}</strong> to the admin team as ${invite.admin_role}.`,
      actorUserId: req.user.id,
      targetType: "admin",
      targetId: userId,
    });

    await sendEmail({
      to: invite.email,
      subject: "Your VETRA admin account is ready",
      html: `<p>Hi ${invite.name},</p><p>Your VETRA admin account (${invite.admin_role}) is ready. Sign in with this temporary password, then change it from Settings:</p><p style="font-size:20px; font-weight:700;">${tempPassword}</p>`,
      logFallback: `new admin ${invite.email}: tempPassword=${tempPassword}`,
    });

    // tempPassword itself no longer leaves the server in the response —
    // the inviting admin was never meant to see the new admin's
    // credential (BACKEND_GUIDE.md §6 point 2); the response shape
    // above only existed as a stand-in for the email step this now is.
    res.status(201).json({ userId });
  })
);

// ---------- Platform settings ----------
// Backs admin/settings.html's "Platform Controls" card — see
// platform_settings in migrations/001_init.sql for what each column
// actually gates. GET is any admin (viewing current settings isn't a
// moderation/management action); PATCH is Super Admin only, same tier
// as site-banners and the admin team routes (BACKEND_GUIDE.md §4
// point 6).
const PLATFORM_SETTING_FIELDS = {
  guestCheckoutEnabled: "guest_checkout_enabled",
  vendorApprovalRequired: "vendor_approval_required",
  vendorVerificationRequired: "vendor_verification_required",
  autoFlagListings: "auto_flag_listings",
  maintenanceMode: "maintenance_mode",
  // Super Admin-only master switch over every individual admin's own
  // kyc_email_alerts_enabled toggle (PATCH /api/auth/me) — see
  // vendors.routes.js's POST /me/kyc for where both are read together.
  kycEmailAlertsEnabled: "kyc_email_alerts_enabled",
};
const PLATFORM_SETTING_LABELS = {
  guestCheckoutEnabled: "guest checkout",
  vendorApprovalRequired: "require vendor approval",
  vendorVerificationRequired: "require vendor verification",
  autoFlagListings: "auto-flag suspicious listings",
  maintenanceMode: "maintenance mode",
  kycEmailAlertsEnabled: "KYC submission email alerts",
};

function serializePlatformSettings(row) {
  const out = {};
  for (const [bodyKey, column] of Object.entries(PLATFORM_SETTING_FIELDS)) {
    out[bodyKey] = !!row?.[column];
  }
  return out;
}

router.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM platform_settings WHERE id = 1`);
    res.json(serializePlatformSettings(rows[0]));
  })
);

router.patch(
  "/settings",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const updates = [];
    const params = [];
    const changedLabels = [];
    for (const [bodyKey, column] of Object.entries(PLATFORM_SETTING_FIELDS)) {
      if (req.body[bodyKey] === undefined) continue;
      if (typeof req.body[bodyKey] !== "boolean") {
        return res.status(400).json({ error: `${bodyKey} must be a boolean.` });
      }
      updates.push(`${column} = ?`);
      params.push(req.body[bodyKey]);
      changedLabels.push(`${req.body[bodyKey] ? "enabled" : "disabled"} ${PLATFORM_SETTING_LABELS[bodyKey]}`);
    }
    if (!updates.length) return res.status(400).json({ error: "No settings to update." });

    await pool.query(`UPDATE platform_settings SET ${updates.join(", ")} WHERE id = 1`, params);
    await logActivity({
      type: "account",
      message: `Platform settings: ${changedLabels.join(", ")}.`,
      actorUserId: req.user.id,
    });

    const [rows] = await pool.query(`SELECT * FROM platform_settings WHERE id = 1`);
    res.json(serializePlatformSettings(rows[0]));
  })
);

module.exports = router;
