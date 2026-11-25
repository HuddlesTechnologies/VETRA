/* =========================================================
   requireAuth: verifies the Authorization: Bearer <token> header
   and attaches the decoded { id, role, adminRole } to req.user.

   requireRole(...roles): gates a route to specific top-level roles
   (buyer/vendor/admin). Compose after requireAuth.

   requirePermission(key): gates an admin route to admins holding one
   permission (role permissions plus personal grants, minus personal
   denials, see utils/adminPermissions.js). req.user.permissions is
   the admin's full effective list.

   requireAdminRole(...adminRoles): gates a route to specific admin
   role names. Only "Super Admin" still uses it, for managing the admin
   team and roles.
   ========================================================= */

const pool = require("../db");
const { permissionsFor } = require("../utils/adminPermissions");
const { recordDevice } = require("../utils/devices");
const { verifyToken } = require("../utils/jwt");

const idleTimeoutMinutes = Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES || 30);
const idleTimeoutMs = (idleTimeoutMinutes > 0 ? idleTimeoutMinutes : 30) * 60 * 1000;

async function authenticate(req, res, next, optional) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    if (optional) return next();
    return res.status(401).json({ error: "Missing bearer token." });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    if (optional) return next();
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  try {
    const [rows] = await pool.query(
      `SELECT role, admin_role, status, last_activity_at, session_version
       FROM users WHERE id = ? LIMIT 1`,
      [payload.id]
    );
    if (!rows[0]) {
      if (optional) return next();
      return res.status(401).json({ error: "Invalid or expired token." });
    }
    const account = rows[0];
    if (["suspended", "deleted", "banned"].includes(account.status)) {
      if (optional) return next();
      return res.status(401).json({ error: "This account is no longer active." });
    }
    if (Number(payload.sessionVersion || 0) !== Number(account.session_version || 0)) {
      if (optional) return next();
      return res.status(401).json({ error: "Session revoked. Please sign in again." });
    }
    const lastActivityAt = rows[0]?.last_activity_at;
    const lastActivityMs = lastActivityAt ? new Date(lastActivityAt).getTime() : Date.now();

    if (Date.now() - lastActivityMs > idleTimeoutMs) {
      if (optional) return next();
      return res.status(401).json({ error: "Session expired due to inactivity." });
    }

    await pool.query(`UPDATE users SET last_activity_at = NOW() WHERE id = ?`, [payload.id]);
    // Picks up devices of accounts that were already signed in before
    // device tracking existed. Throttled inside recordDevice.
    if (account.role !== "admin") await recordDevice(payload.id, req);
    req.user = {
      ...payload,
      role: account.role,
      adminRole: account.admin_role || null,
      sessionVersion: account.session_version || 0,
      ...(account.role === "admin" ? { permissions: await permissionsFor(payload.id, account.admin_role) } : {}),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, res, next) {
  authenticate(req, res, next, false);
}

// Attaches req.user when a valid token is present, but doesn't reject the
// request when it's absent or invalid, for routes that work both signed
// in and as a guest (checkout, when "Allow guest checkout" is on).
function optionalAuth(req, res, next) {
  authenticate(req, res, next, true);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Not allowed for this account type." });
    }
    next();
  };
}

function requireAdminRole(...adminRoles) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== "admin" || !adminRoles.includes(req.user.adminRole)) {
      return res.status(403).json({ error: "Not allowed for this admin role." });
    }
    next();
  };
}

function hasPermission(user, key) {
  return Boolean(user && user.role === "admin" && Array.isArray(user.permissions) && user.permissions.includes(key));
}

function requirePermission(key) {
  return (req, res, next) => {
    if (!hasPermission(req.user, key)) {
      return res.status(403).json({ error: "You don't have permission to do this." });
    }
    next();
  };
}

module.exports = { requireAuth, optionalAuth, requireRole, requireAdminRole, requirePermission, hasPermission };
