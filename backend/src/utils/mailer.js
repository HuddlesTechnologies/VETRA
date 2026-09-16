/* =========================================================
   Email delivery — Resend (see BACKEND_GUIDE.md/README's env var list).
   Same "sign up, no card, two-line SDK call" reasoning as
   src/utils/cloudinary.js's choice of provider.

   Until RESEND_API_KEY is set, sendEmail() logs to the server console
   instead of throwing — every call site that used to only
   console.log() a code/link/password (admin.routes.js's invite,
   password-reset, and new-admin-temp-password flows) keeps working
   exactly as before with no env var configured, and starts actually
   delivering the moment it is. This mirrors how Cloudinary uploads
   behave before its own env vars are set (see uploads.routes.js).

   EMAIL_FROM must be an address on a domain verified in the Resend
   dashboard (resend.com/domains) — Resend's own onboarding@resend.dev
   sender only delivers to the account's own verified email, not real
   end users, so it's a fine way to smoke-test but not a real "from"
   address for production. Defaults to that sandbox address so a
   freshly-configured RESEND_API_KEY with no domain yet still sends
   *something* rather than erroring outright.
   ========================================================= */

const { Resend } = require("resend");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || "VETRA <onboarding@resend.dev>";

async function sendEmail({ to, subject, html, logFallback }) {
  if (!resend) {
    console.log(`[email:not-configured] to=${to} subject="${subject}" — ${logFallback}`);
    return { delivered: false };
  }
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
    return { delivered: true };
  } catch (err) {
    // A delivery failure (bad domain, rate limit, etc.) shouldn't break
    // the action that triggered it — the same code/link is still logged
    // server-side as a fallback, matching pre-Resend behavior.
    console.error(`[email:failed] to=${to} subject="${subject}":`, err.message);
    console.log(`[email:fallback] ${logFallback}`);
    return { delivered: false, error: err.message };
  }
}

module.exports = { sendEmail };
