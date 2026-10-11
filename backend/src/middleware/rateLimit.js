/* =========================================================
   Per-IP rate limits for the endpoints that don't already require a
   valid session — signin, signup, password-reset-link redemption, and
   the AI shopping assistant (optionalAuth, so fully anonymous-reachable
   too) are the ways into this app an attacker can hit anonymously and
   repeatedly, so they're the routes that need this. Everything else
   sits behind requireAuth already.

   Each limiter is deliberately separate (not one shared instance)
   so admin-signin, the highest-value target, since a compromised
   admin account reaches every other account on the platform, gets
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

// Admin signin, tighter, since this is the highest-value target.
const adminSigninLimiter = makeLimiter({
  windowMinutes: 15,
  max: 5,
  message: "Too many sign-in attempts. Try again in a few minutes.",
});

// "Continue with Google" (signup-or-signin in one call), anonymous-
// reachable the same way signin/signup are, so it needs the same kind
// of throttle; kept separate from signinLimiter so it can create new
// accounts without inheriting that limiter's much lower ceiling.
const googleAuthLimiter = makeLimiter({
  windowMinutes: 15,
  max: 10,
  message: "Too many attempts. Try again in a few minutes.",
});

// Signup — generous enough for real shared-network/office/campus
// traffic, tight enough to block mass account creation.
const signupLimiter = makeLimiter({
  windowMinutes: 60,
  max: 20,
  message: "Too many accounts created from this network recently. Try again later.",
});

// Password-reset-link redemption (POST /api/auth/reset-password), the
// token itself is 24 random bytes, effectively unguessable, but this
// is cheap defense-in-depth against a script hammering the endpoint.
const resetPasswordLimiter = makeLimiter({
  windowMinutes: 15,
  max: 10,
  message: "Too many attempts. Try again in a few minutes.",
});

// AI shopping assistant, anonymous-reachable and calls a paid Anthropic
// API on every request, so it needs its own throttle the way the other
// anonymous-reachable routes above do.
const assistantChatLimiter = makeLimiter({
  windowMinutes: 15,
  max: 20,
  message: "Too many messages. Try again in a few minutes.",
});

// 2FA code verification, a 6-digit code is a 1-in-1,000,000 guess, and
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

// Public delivery endpoints (fee quote, tracking-code lookup), anonymous-
// reachable, so throttled against someone enumerating tracking codes.
const deliveryPublicLimiter = makeLimiter({
  windowMinutes: 15,
  max: 120,
  message: "Too many requests. Try again in a few minutes.",
});

// Pickup/delivery code entry (rider and vendor). The per-order attempt
// cap in utils/delivery.js is the real defense for the buyer's 6-digit
// code; this also covers the rider's 4-digit pickup code.
const deliveryCodeLimiter = makeLimiter({
  windowMinutes: 15,
  max: 20,
  message: "Too many code attempts. Try again in a few minutes.",
});

// KYC verification, every attempt is a paid IDCheck.ng lookup (identity
// plus CAC). Keyed per vendor account, not per IP, so the cap holds no
// matter where the requests come from; runs after requireAuth.
const kycVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `kyc:${req.user.id}`,
  message: { error: "Too many verification attempts. Try again in an hour, or wait for an admin to review your submission." },
});

// Public contact form. Real people send one or two messages; this stops
// a script filling the admin inbox.
const contactLimiter = makeLimiter({
  windowMinutes: 60,
  max: 5,
  message: "You've sent several messages already. Please wait a while before sending another.",
});

module.exports = {
  contactLimiter,
  kycVerifyLimiter,
  deliveryPublicLimiter,
  deliveryCodeLimiter,
  signinLimiter,
  adminSigninLimiter,
  googleAuthLimiter,
  signupLimiter,
  resetPasswordLimiter,
  assistantChatLimiter,
  twoFactorVerifyLimiter,
  twoFactorResendLimiter,
  uploadLimiter,
};
