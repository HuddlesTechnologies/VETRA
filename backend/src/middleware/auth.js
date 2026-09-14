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

const { verifyToken } = require("../utils/jwt");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing bearer token." });

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

// Attaches req.user when a valid token is present, but doesn't reject the
// request when it's absent or invalid — for routes that work both signed
// in and as a guest (checkout, when "Allow guest checkout" is on).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      req.user = verifyToken(token);
    } catch {
      // Invalid/expired token on an optional-auth route — proceed as a guest
      // rather than failing the request.
    }
  }
  next();
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
