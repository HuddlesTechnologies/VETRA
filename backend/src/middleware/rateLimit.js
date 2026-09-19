/* =========================================================
   Per-IP rate limits for the endpoints that don't already require a
   valid session — signin, signup, password-reset-link redemption, and
   the AI shopping assistant (optionalAuth, so fully anonymous-reachable
   too) are the ways into this app an attacker can hit anonymously and
   repeatedly, so they're the routes that need this. Everything else
   sits behind requireAuth already.

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

// AI shopping assistant — anonymous-reachable and calls a paid Anthropic
// API on every request, so it needs its own throttle the way the other
// anonymous-reachable routes above do.
const assistantChatLimiter = makeLimiter({
  windowMinutes: 15,
  max: 20,
  message: "Too many messages. Try again in a few minutes.",
});

// 2FA code verification — a 6-digit code is a 1-in-1,000,000 guess, and
// the per-code attempt cap in auth.routes.js is the real defense, but
// this still throttles a script hammering the endpoint across many codes.
const twoFactorVerifyLimiter = makeLimiter({
  windowMinutes: 15,
  max: 20,
  message: "Too many attempts. Try again in a few minutes.",
});

// 2FA resend — separate and tighter than verify so it can't be used to
// email-bomb an account.
const twoFactorResendLimiter = makeLimiter({
  windowMinutes: 15,
  max: 5,
  message: "Too many codes requested. Try again in a few minutes.",
});

// Authenticated uploads still need an abuse ceiling because each request
// consumes memory and external Cloudinary bandwidth.
const uploadLimiter = makeLimiter({
  windowMinutes: 15,
  max: 30,
  message: "Too many uploads. Try again in a few minutes.",
});

module.exports = {
  signinLimiter,
  adminSigninLimiter,
  signupLimiter,
  resetPasswordLimiter,
  assistantChatLimiter,
  twoFactorVerifyLimiter,
  twoFactorResendLimiter,
  uploadLimiter,
};
