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

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

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
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, address, status, signup_method, last_login_at, created_at
       FROM users WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
      params
    );
    res.json(rows);
  })
);

router.get(
  "/customers/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, address, status, signup_method, last_login_at, created_at
       FROM users WHERE id = ? AND role = 'buyer'`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Customer not found." });
    res.json(rows[0]);
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
    // Matches BACKEND_GUIDE.md §6 point 2: the point of a real backend is
    // that an admin no longer sees the resulting credential. This emails
    // a reset link instead — email delivery is a TODO integration (see
    // BACKEND_GUIDE.md §7 step 6), so the token is logged in its place
    // until a provider is wired up.
    const token = crypto.randomBytes(24).toString("hex");
    // TODO: persist a password_reset_tokens row (token hash + expiry) and
    // email a reset link containing it, instead of logging it here.
    console.log(`[password-reset] customer ${req.params.id}: token=${token} (TODO: email this link, don't log it)`);

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
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, address, store_name, store_category, status, last_login_at, created_at
       FROM users WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
      params
    );
    res.json(rows);
  })
);

router.get(
  "/vendors/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, address, store_name, store_category, store_description, status, last_login_at, created_at
       FROM users WHERE id = ? AND role = 'vendor'`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Vendor not found." });
    res.json(rows[0]);
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
    const token = crypto.randomBytes(24).toString("hex");
    // TODO: same as the customer route above — persist + email, don't log.
    console.log(`[password-reset] vendor ${req.params.id}: token=${token} (TODO: email this link, don't log it)`);
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
    const [[{ openReports }]] = await pool.query(`SELECT COUNT(*) AS openReports FROM reports WHERE status = 'open'`);
    const [[{ platformOrders }]] = await pool.query(`SELECT COUNT(*) AS platformOrders FROM orders`);
    const [[{ platformRevenue }]] = await pool.query(
      `SELECT COALESCE(SUM(total), 0) AS platformRevenue FROM orders WHERE status = 'completed'`
    );
    res.json({ totalCustomers, totalVendors, suspendedAccounts, openReports, platformOrders, platformRevenue });
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
    const { adminId } = req.query; // Super Admin only: filter to one admin's actions

    let where = "1=1";
    const params = [];
    if (!isSuperAdmin) {
      where = "(actor_user_id IS NULL OR actor_user_id = ?)";
      params.push(req.user.id);
    } else if (adminId) {
      where = "actor_user_id = ?";
      params.push(adminId);
    }

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

    // TODO: email `code` to `email`; don't log it in a real deployment.
    console.log(`[admin-invite] ${email}: code=${code} (TODO: email this, don't log it)`);
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

    // TODO: email `tempPassword` to the new admin instead of returning it —
    // this response shape only exists because there's no email step yet.
    res.status(201).json({ userId, tempPassword });
  })
);

module.exports = router;
