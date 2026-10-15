/* =========================================================
   Email delivery: SMTP through the cPanel account's own mail server
   (nodemailer). Every transactional email the app sends goes through
   sendEmail() here: password resets, admin invites, 2FA codes, order
   and delivery updates, KYC decisions, low-stock alerts.

   Configure with SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER /
   SMTP_PASS (a mailbox created under cPanel > Email Accounts, e.g.
   noreply@vetrahq.org) and EMAIL_FROM. See backend/README.md,
   "Setting up on cPanel", for the exact values and the SPF/DKIM step that
   keeps these out of spam folders.

   Until SMTP_HOST is set, sendEmail() logs to the server console
   instead of sending: every call site keeps working with no mail
   configured (codes and links appear in the log), and starts actually
   delivering the moment it is.

   sendEmail() never throws. It's awaited inside request handlers after
   the real action has succeeded, so a mail failure must not turn that
   into an error for the user. The short timeouts below matter for the
   same reason: a mail server that doesn't answer would otherwise hold
   the user's request open for minutes.
   ========================================================= */

const nodemailer = require("nodemailer");

const SMTP_PORT = Number(process.env.SMTP_PORT || 465);

const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: SMTP_PORT,
      // 465 is implicit TLS; 587 starts plain and upgrades with STARTTLS.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : SMTP_PORT === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      // A couple of reused connections instead of a fresh login per email,
      // kept small because shared hosting caps concurrent processes.
      pool: true,
      maxConnections: 2,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    })
  : null;

const FROM = process.env.EMAIL_FROM || (process.env.SMTP_USER ? `VETRA <${process.env.SMTP_USER}>` : "VETRA <noreply@vetrahq.org>");

// Plain-text alternative for mail clients (and spam filters) that want
// one; every message here is short HTML, so stripping tags is enough.
function htmlToText(html) {
  return String(html)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href, text) => (text.trim() === href ? href : `${text} (${href})`))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|h\d|li|table)>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&times;/g, "×")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sendEmail({ to, subject, html, logFallback }) {
  if (!transporter) {
    console.log(`[email:not-configured] to=${to} subject="${subject}" — ${logFallback}`);
    return { delivered: false };
  }
  try {
    const info = await transporter.sendMail({ from: FROM, to, subject, html, text: htmlToText(html) });
    // An SMTP server can accept the message for some recipients and
    // reject others; with one recipient, any rejection is a failure.
    if (info.rejected && info.rejected.length) {
      throw new Error(`rejected by server: ${info.rejected.join(", ")} ${info.response || ""}`.trim());
    }
    return { delivered: true, id: info.messageId };
  } catch (err) {
    // Same fallback as an unconfigured mailer: the code or link still
    // lands in the server log, so support can recover it.
    console.error(`[email:failed] to=${to} subject="${subject}":`, err.message);
    console.log(`[email:fallback] ${logFallback}`);
    return { delivered: false, error: err.message };
  }
}

// Called once at startup (server.js) so a wrong host, port or password
// shows up in the app's log immediately rather than on the first
// password reset someone requests.
async function verifyMailer() {
  if (!transporter) {
    console.log("[email] SMTP_HOST not set, emails will be logged instead of sent.");
    return;
  }
  try {
    await transporter.verify();
    console.log(`[email] SMTP ready: ${process.env.SMTP_HOST}:${SMTP_PORT} as ${process.env.SMTP_USER || "(no auth)"}`);
  } catch (err) {
    console.error(`[email] SMTP check failed (${process.env.SMTP_HOST}:${SMTP_PORT}): ${err.message}`);
  }
}

module.exports = { sendEmail, verifyMailer };
