/* =========================================================
   /api/auth — replaces the mock checks in signin.js/signup.js/
   admin/login.html's inline script (see BACKEND_GUIDE.md §4).
   Buyer and vendor share a signup/signin pair since they're the
   same flow with a different `role`; admin signin is separate
   since admins are never self-service signups.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { newId } = require("../utils/id");
const { hashPassword, verifyPassword } = require("../utils/password");
const { signToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");

const router = express.Router();

router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const { role, name, email, password, phone, storeName, storeCategory } = req.body;

    if (!["buyer", "vendor"].includes(role)) {
      return res.status(400).json({ error: "role must be 'buyer' or 'vendor'." });
    }
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, and password are required." });
    }
    if (role === "vendor" && !storeName) {
      return res.status(400).json({ error: "storeName is required for a vendor signup." });
    }

    const id = newId();
    const passwordHash = await hashPassword(password);
    // Vendors start "pending" until an admin approves the application —
    // matches admin/vendors.html's existing Pending Approval workflow.
    const status = role === "vendor" ? "pending" : "active";

    await pool.query(
      `INSERT INTO users (id, role, name, email, phone, password_hash, status, store_name, store_category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, role, name, email, phone || null, passwordHash, status, storeName || null, storeCategory || null]
    );

    if (role === "vendor") {
      await logActivity({
        type: "vendor",
        message: `New vendor application from <strong>${storeName}</strong>.`,
        targetType: "vendor",
        targetId: id,
      });
    }

    const token = signToken({ id, role });
    res.status(201).json({ token, user: { id, role, name, email, status } });
  })
);

router.post(
  "/signin",
  asyncHandler(async (req, res) => {
    const { role, email, password } = req.body;
    if (!["buyer", "vendor"].includes(role)) {
      return res.status(400).json({ error: "role must be 'buyer' or 'vendor'." });
    }

    const [rows] = await pool.query(
      `SELECT * FROM users WHERE email = ? AND role = ? LIMIT 1`,
      [email, role]
    );
    const user = rows[0];
    if (!user || !(await verifyPassword(password || "", user.password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    if (user.status === "suspended") {
      return res.status(403).json({ error: "This account has been suspended. Contact support." });
    }

    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id]);
    await logActivity({
      type: "login",
      message: `${role === "vendor" ? "Vendor" : "Customer"} <strong>${user.name}</strong> signed in.`,
      targetType: role,
      targetId: user.id,
    });

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, role: user.role, name: user.name, email: user.email, status: user.status },
    });
  })
);

router.post(
  "/admin-signin",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const [rows] = await pool.query(
      `SELECT * FROM users WHERE email = ? AND role = 'admin' LIMIT 1`,
      [email]
    );
    const admin = rows[0];
    if (!admin || !(await verifyPassword(password || "", admin.password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [admin.id]);
    await logActivity({
      type: "login",
      message: `Admin <strong>${admin.email}</strong> signed in to the admin console.`,
      actorUserId: admin.id,
    });

    const token = signToken(admin);
    res.json({
      token,
      user: { id: admin.id, name: admin.name, email: admin.email, adminRole: admin.admin_role },
    });
  })
);

// Requires the current password even though customer/settings.html's
// Security form no longer collects one (see BACKEND_GUIDE.md §4 point 5 —
// that was a UI call, not license to skip verification server-side; a
// leaked/stolen token would otherwise be enough to lock the real owner out).
router.patch(
  "/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters." });
    }

    const [rows] = await pool.query(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    const user = rows[0];
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const newHash = await hashPassword(newPassword);
    await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, req.user.id]);
    await logActivity({
      type: "account",
      message: "Changed account password.",
      actorUserId: req.user.id,
      targetType: req.user.role,
      targetId: req.user.id,
    });
    res.json({ ok: true });
  })
);

// Companion read for PATCH /me below — POST /signup and /signin only
// return {id, role, name, email, status} (what's needed at that
// moment), not the full profile, so a page that wants to actually
// display/edit phone, address, or a vendor's store fields needs a
// real fetch, not just what login happened to return.
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, role, name, email, phone, address, avatar_url, store_name, store_category, store_description, store_cover_url, admin_role
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Account not found." });
    res.json(rows[0]);
  })
);

// Generic "update my own profile" — the real endpoint behind every
// per-field pencil-edit save on vendor/profile.html's Store Details,
// customer/settings.html's Profile card, and admin/settings.html's
// Account Details card (all three call this same route today, one
// field at a time, per their own `// TODO: replace with a real
// per-field save API call` comment). Also where a freshly-uploaded
// avatar/cover URL (POST /api/uploads) actually gets attached to the
// account, since that route only returns a URL and doesn't persist it.
router.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const fieldMap = { name: "name", email: "email", phone: "phone", address: "address", avatarUrl: "avatar_url" };
    if (req.user.role === "vendor") {
      Object.assign(fieldMap, {
        storeName: "store_name",
        storeCategory: "store_category",
        storeDescription: "store_description",
        storeCoverUrl: "store_cover_url",
      });
    }

    const updates = [];
    const params = [];
    for (const [bodyKey, column] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        updates.push(`${column} = ?`);
        params.push(req.body[bodyKey]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: "No fields to update." });

    params.push(req.user.id);
    await pool.query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);

    const [rows] = await pool.query(
      `SELECT id, role, name, email, phone, address, avatar_url, store_name, store_category, store_description, store_cover_url, admin_role
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    res.json(rows[0]);
  })
);

module.exports = router;
