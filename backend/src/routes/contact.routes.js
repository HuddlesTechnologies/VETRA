/* =========================================================
   /api/contact: the public contact form (contact.html). Messages are
   stored in contact_messages, every admin gets an in-app notification,
   and the sender gets a confirmation email. Admins read and answer them
   from admin/messages.html (admin.routes.js, /api/admin/messages).
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { newId } = require("../utils/id");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");
const { notify } = require("../utils/notify");
const { sendEmail } = require("../utils/mailer");
const { escapeHtml } = require("../utils/escapeHtml");
const { contactLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (value, max) => String(value || "").trim().slice(0, max);

router.post(
  "/",
  contactLimiter,
  asyncHandler(async (req, res) => {
    // Honeypot: a field real visitors never see. Bots that fill every
    // input get a normal-looking success and nothing is stored.
    if (clean(req.body.website, 200)) return res.status(201).json({ ok: true });

    const senderType = req.body.senderType === "vendor" ? "vendor" : "buyer";
    const name = clean(req.body.name, 120);
    const email = clean(req.body.email, 190).toLowerCase();
    const message = clean(req.body.message, 5000);
    const topic = clean(req.body.topic, 120) || null;
    const orderRef = senderType === "buyer" ? clean(req.body.orderRef, 40).toUpperCase() || null : null;
    const businessName = senderType === "vendor" ? clean(req.body.businessName, 120) || null : null;

    if (!name) return res.status(400).json({ error: "Enter your name." });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address so we can reply." });
    if (message.length < 10) return res.status(400).json({ error: "Tell us a little more in your message." });

    const id = newId();
    await pool.query(
      `INSERT INTO contact_messages (id, sender_type, name, email, topic, order_ref, business_name, message, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, senderType, name, email, topic, orderRef, businessName, message, req.ip || null]
    );

    await logActivity({
      type: "contact",
      message: `New ${senderType} message from <strong>${escapeHtml(name)}</strong>${topic ? `: ${escapeHtml(topic)}` : ""}.`,
      targetType: "contact_message",
      targetId: id,
    });
    const [admins] = await pool.query(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`);
    for (const admin of admins) {
      await notify({
        userId: admin.id,
        type: "contact",
        title: "New contact message",
        message: `${escapeHtml(name)} (${senderType})${topic ? `: ${escapeHtml(topic)}` : ""}`,
        link: "messages.html",
      });
    }
    await sendEmail({
      to: email,
      subject: "VETRA: we got your message",
      html: `<p>Hi ${escapeHtml(name)},</p><p>Thanks for getting in touch. We've received your message and will reply to this address, usually within one business day.</p><p style="color:#6e6e73">Your message:</p><blockquote style="margin:0;padding:8px 12px;border-left:3px solid #d2d2d7;color:#1d1d1f">${escapeHtml(message).replace(/\n/g, "<br>")}</blockquote>`,
      logFallback: `contact confirmation for ${email}`,
    });

    res.status(201).json({ ok: true });
  })
);

module.exports = router;
