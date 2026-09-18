/* =========================================================
   requireAuth: verifies the Authorization: Bearer <token> header
   and attaches the decoded { id, role, adminRole } to req.user.

   requireRole(...roles): gates a route to specific top-level roles
   (buyer/vendor/admin). Compose after requireAuth.

   requireAdminRole(...adminRoles): gates a route to specific admin
   sub-roles (Super Admin/Moderator/Support). This is the actual
   server-side enforcement the prototype never had — see
   BACKEND_GUIDE.md §6 point 1 and point 6.
   ========================================================= */

const pool = require("../db");
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
      `SELECT last_activity_at FROM users WHERE id = ? LIMIT 1`,
      [payload.id]
    );
    if (!rows[0]) {
      if (optional) return next();
      return res.status(401).json({ error: "Invalid or expired token." });
    }
    const lastActivityAt = rows[0]?.last_activity_at;
    const lastActivityMs = lastActivityAt ? new Date(lastActivityAt).getTime() : Date.now();

    if (Date.now() - lastActivityMs > idleTimeoutMs) {
      if (optional) return next();
      return res.status(401).json({ error: "Session expired due to inactivity." });
    }

    await pool.query(`UPDATE users SET last_activity_at = NOW() WHERE id = ?`, [payload.id]);
    req.user = payload;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, res, next) {
  authenticate(req, res, next, false);
}

// Attaches req.user when a valid token is present, but doesn't reject the
// request when it's absent or invalid — for routes that work both signed
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

module.exports = { requireAuth, optionalAuth, requireRole, requireAdminRole };
