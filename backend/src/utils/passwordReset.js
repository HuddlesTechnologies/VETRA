/* =========================================================
   Emails a one-time "set a new password" link. Used for the
   admin-triggered customer/vendor reset (admin.routes.js) and for
   onboarding a newly created rider (delivery.routes.js), who never
   chooses a password at signup because admins create rider accounts.

   Generates a raw token, stores only its SHA-256 hash (see
   password_reset_tokens in migrations/001_init.sql), and emails a
   link containing the raw token to reset-password.html, which
   redeems it via POST /api/auth/reset-password.
   ========================================================= */

const crypto = require("crypto");
const pool = require("../db");
const { newId } = require("./id");
const { sendEmail } = require("./mailer");
const { escapeHtml } = require("./escapeHtml");

// Base URL for links inside emails. The backend has no other way to
// know where the frontend is actually served from.
const FRONTEND_URL = process.env.FRONTEND_URL || "https://vetrahq.org";

// linkFor: "admin" or "rider" makes reset-password.html point back to
// that app's sign-in page instead of the storefront one.
async function createAndEmailPasswordReset(user, { expiresInHours = 1, subject, introHtml, linkFor } = {}) {
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    [newId(), user.id, tokenHash, expiresAt]
  );

  const resetUrl = `${FRONTEND_URL}/reset-password.html?token=${rawToken}${["admin", "rider"].includes(linkFor) ? `&for=${linkFor}` : ""}`;
  const expiryLabel = expiresInHours === 1 ? "1 hour" : `${expiresInHours} hours`;
  await sendEmail({
    to: user.email,
    subject: subject || "Reset your VETRA password",
    html: `<p>Hi ${escapeHtml(user.name)},</p><p>${introHtml || "An admin requested a password reset for your VETRA account. Click below to set a new password."} This link expires in ${expiryLabel}.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't expect this, you can ignore this email.</p>`,
    logFallback: `password link for ${user.email}: ${resetUrl}`,
  });
}

module.exports = { createAndEmailPasswordReset, FRONTEND_URL };
