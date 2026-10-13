/* =========================================================
   "Your account was deleted" email, shared by the admin delete routes
   (admin.routes.js) and self-service deletion (auth.routes.js). Sent to
   the address captured before the row is scrubbed, since deletion
   replaces the email with a placeholder.
   ========================================================= */

const { sendEmail } = require("./mailer");
const { escapeHtml } = require("./escapeHtml");

async function sendAccountDeletedEmail({ email, name, byAdmin, reason }) {
  if (!email || email.endsWith("@vetra.deleted")) return;
  const intro = byAdmin
    ? "Your VETRA account has been deleted by our team."
    : "As you requested, your VETRA account has been deleted.";
  const reasonLine = byAdmin && reason ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : "";
  const outro = byAdmin
    ? "<p>If you think this was a mistake, reply to this email or contact support@vetrahq.org.</p>"
    : "<p>If you didn't ask for this, contact support@vetrahq.org right away.</p>";
  await sendEmail({
    to: email,
    subject: "Your VETRA account has been deleted",
    html: `<p>Hi ${escapeHtml(name || "there")},</p><p>${intro} You can no longer sign in with it, and your personal details have been removed. Records of past orders are kept for the other party's history.</p>${reasonLine}${outro}`,
    logFallback: `account deleted email for ${email} (byAdmin: ${!!byAdmin})`,
  });
}

module.exports = { sendAccountDeletedEmail };
