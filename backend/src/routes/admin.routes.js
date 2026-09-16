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
const { ORDER_ITEMS_SUBQUERY } = require("../utils/orderItemsSubquery");
const { sendEmail } = require("../utils/mailer");

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
    const clauses = ["role = 'buyer'"];
    const params = [];
    if (q) {
      clauses.push("(name LIKE ? OR email LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    // order_count/total_spent power admin/customers.html's table columns —
    // real aggregates over that customer's own orders, not stored counters.
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.address, u.status, u.signup_method, u.last_login_at, u.created_at,
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
      `SELECT u.id, u.name, u.email, u.phone, u.address, u.status, u.signup_method, u.last_login_at, u.created_at,
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

    await pool.query(`UPDATE users SET status = ? WHERE id = ?`, [status, req.params.id]);
    await logActivity({
      type: "account",
      message: `${status === "suspended" ? "Suspended" : "Reactivated"} customer <strong>${rows[0].name}</strong>${reason ? ` — ${reason}` : ""}.`,
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
    const { status } = req.query;
    const clauses = ["role = 'vendor'"];
    const params = [];
    if (status && status !== "all") {
      clauses.push("status = ?");
      params.push(status);
    }
    // products_count/orders_count/revenue power admin/vendors.html's table
    // columns — real aggregates, same reasoning as the customers route above.
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.address, u.store_name, u.store_category, u.status, u.last_login_at, u.created_at,
              (SELECT COUNT(*) FROM products p WHERE p.vendor_id = u.id AND p.status = 'active') AS products_count,
              (SELECT COUNT(*) FROM orders o WHERE o.vendor_id = u.id) AS orders_count,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.vendor_id = u.id AND o.status = 'completed') AS revenue
       FROM users u WHERE ${clauses.join(" AND ")} ORDER BY u.created_at DESC LIMIT 200`, // safety-net cap, not real pagination
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
              u.status, u.last_login_at, u.created_at,
              (SELECT COUNT(*) FROM products p WHERE p.vendor_id = u.id AND p.status = 'active') AS products_count,
              (SELECT COUNT(*) FROM orders o WHERE o.vendor_id = u.id) AS orders_count,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.vendor_id = u.id AND o.status = 'completed') AS revenue,
              vk.status AS kyc_status, vk.cac_number AS kyc_cac_number,
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

router.patch(
  "/vendors/:id/status",
  requireAdminRole("Super Admin", "Moderator"),
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body;
    if (!["active", "suspended", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be 'active', 'suspended', or 'rejected'." });
    }

    const [rows] = await pool.query(`SELECT store_name FROM users WHERE id = ? AND role = 'vendor'`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Vendor not found." });

    await pool.query(`UPDATE users SET status = ? WHERE id = ?`, [status, req.params.id]);
    const verb = { active: "Approved", suspended: "Suspended", rejected: "Rejected" }[status];
    await logActivity({
      type: "vendor",
      message: `${verb} vendor <strong>${rows[0].store_name}</strong>${reason ? ` — ${reason}` : ""}.`,
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

    const [rows] = await pool.query(
      `SELECT vk.status, u.store_name FROM vendor_kyc vk
       JOIN users u ON u.id = vk.vendor_id
       WHERE vk.vendor_id = ?`,
      [req.params.id]
    );
    const kyc = rows[0];
    if (!kyc) return res.status(404).json({ error: "This vendor has no KYC submission on file." });
    if (kyc.status !== "pending") {
      return res.status(400).json({ error: "This vendor has no pending KYC submission to review." });
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
      message: `${verb} KYC documents for <strong>${kyc.store_name}</strong>${reason ? ` — ${reason}` : ""}.`,
      actorUserId: req.user.id,
      targetType: "vendor",
      targetId: req.params.id,
    });
    res.json({ ok: true });
  })
);

// ---------- Stats ----------
router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const [[{ totalCustomers }]] = await pool.query(`SELECT COUNT(*) AS totalCustomers FROM users WHERE role = 'buyer'`);
    const [[{ totalVendors }]] = await pool.query(`SELECT COUNT(*) AS totalVendors FROM users WHERE role = 'vendor'`);
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
    const [[{ platformOrders }]] = await pool.query(`SELECT COUNT(*) AS platformOrders FROM orders`);
    const [[{ platformRevenue }]] = await pool.query(
      `SELECT COALESCE(SUM(total), 0) AS platformRevenue FROM orders WHERE status = 'completed'`
    );
    res.json({
      totalCustomers, totalVendors, suspendedAccounts, suspendedCustomers, suspendedVendors,
      pendingVendors, openReports, platformOrders, platformRevenue,
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

router.delete(
  "/team/:id",
  requireAdminRole("Super Admin"),
  asyncHandler(async (req, res) => {
    const [[{ superAdminCount }]] = await pool.query(
      `SELECT COUNT(*) AS superAdminCount FROM users WHERE role = 'admin' AND admin_role = 'Super Admin'`
    );
    const [target] = await pool.query(`SELECT admin_role FROM users WHERE id = ? AND role = 'admin'`, [req.params.id]);
    if (!target[0]) return res.status(404).json({ error: "Admin not found." });
    if (target[0].admin_role === "Super Admin" && superAdminCount <= 1) {
      return res.status(400).json({ error: "Can't remove the platform's last Super Admin." });
    }

    await pool.query(`DELETE FROM users WHERE id = ?`, [req.params.id]);
    await logActivity({
      type: "account",
      message: `Removed admin team member.`,
      actorUserId: req.user.id,
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
      message: `Added <strong>${invite.name}</strong> to the admin team as ${invite.admin_role}.`,
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

module.exports = router;
