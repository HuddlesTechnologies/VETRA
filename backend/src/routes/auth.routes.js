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

module.exports = router;
