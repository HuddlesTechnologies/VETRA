/* JWT, sent in an Authorization header rather than a session cookie —
   see BACKEND_GUIDE.md §2 for why. The payload carries exactly what
   every route's role check needs (id + role), nothing more. */
const jwt = require("jsonwebtoken");

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, adminRole: user.admin_role || null },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
