/* JWT, sent in an Authorization header rather than a session cookie,
   see BACKEND_GUIDE.md §2 for why. The payload carries exactly what
   every route's role check needs (id + role), nothing more. */
const jwt = require("jsonwebtoken");

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      adminRole: user.admin_role || null,
      sessionVersion: user.session_version || 0,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

function verifyToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  // A 2FA challenge token is not a session. Without this check it would
  // pass requireAuth as if the password-only half of sign-in were enough.
  if (payload.purpose) throw new Error("Not a session token.");
  return payload;
}

// Proof that the password step of a 2FA sign-in succeeded. /2fa/verify
// and /2fa/resend require it, so knowing an account's id (vendor ids are
// public in store URLs) is never enough to request or guess codes.
// Bound to session_version, which every completed sign-in increments,
// so a challenge dies as soon as it has been used.
function signTwoFactorChallenge(user) {
  return jwt.sign(
    { id: user.id, purpose: "2fa", sessionVersion: user.session_version || 0 },
    process.env.JWT_SECRET,
    { expiresIn: "10m" }
  );
}

function verifyTwoFactorChallenge(token) {
  const payload = jwt.verify(String(token || ""), process.env.JWT_SECRET);
  if (payload.purpose !== "2fa") throw new Error("Not a 2FA challenge.");
  return payload;
}

module.exports = { signToken, verifyToken, signTwoFactorChallenge, verifyTwoFactorChallenge };
