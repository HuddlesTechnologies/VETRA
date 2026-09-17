/* =========================================================
   Per-IP rate limits for the auth endpoints that don't already
   require a valid session — signin, signup, and password-reset-link
   redemption are the only ways into this app that an attacker can
   hit anonymously and repeatedly, so they're the only routes that
   need this. Everything else sits behind requireAuth already.

   Each limiter is deliberately separate (not one shared instance)
   so admin-signin — the highest-value target, since a compromised
   admin account reaches every other account on the platform — gets
   the tightest limit, independent from the much higher, more
   forgiving one on ordinary customer/vendor signin.
   ========================================================= */

const rateLimit = require("express-rate-limit");

function makeLimiter({ windowMinutes, max, message }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

// Customer/vendor signin.
const signinLimiter = makeLimiter({
  windowMinutes: 15,
  max: 10,
  message: "Too many sign-in attempts. Try again in a few minutes.",
});

// Admin signin — tighter, since this is the highest-value target.
const adminSigninLimiter = makeLimiter({
  windowMinutes: 15,
  max: 5,
  message: "Too many sign-in attempts. Try again in a few minutes.",
});

// Signup — generous enough for real shared-network/office/campus
// traffic, tight enough to block mass account creation.
const signupLimiter = makeLimiter({
  windowMinutes: 60,
  max: 20,
  message: "Too many accounts created from this network recently. Try again later.",
});

// Password-reset-link redemption (POST /api/auth/reset-password) — the
// token itself is 24 random bytes, effectively unguessable, but this
// is cheap defense-in-depth against a script hammering the endpoint.
const resetPasswordLimiter = makeLimiter({
  windowMinutes: 15,
  max: 10,
  message: "Too many attempts. Try again in a few minutes.",
});

module.exports = { signinLimiter, adminSigninLimiter, signupLimiter, resetPasswordLimiter };
