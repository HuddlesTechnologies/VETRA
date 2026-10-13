/* =========================================================
   /api/vendors: public vendor directory (customer/vendors.html's
   search, customer/store.html's storefront) plus a vendor's own
   Business Verification (KYC) submission, see BACKEND_GUIDE.md §5.

   `/me/kyc` is declared before `/:id` so "me" is never swallowed by
   the `:id` param route. Express matches in declaration order, and
   both patterns match a single path segment, so ordering is what
   disambiguates them, not specificity.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { encrypt, decrypt } = require("../utils/encryption");
const { notify } = require("../utils/notify");
const { sendEmail } = require("../utils/mailer");
const { escapeHtml } = require("../utils/escapeHtml");
const { payoutAccountRouter } = require("../utils/payoutAccount");
const { kycVerifyLimiter } = require("../middleware/rateLimit");
const { verifyNin, verifyBvn, verifyDriversLicence, verifyCac } = require("../utils/idcheck");
const { privateKeyFromUrl, signedUrl } = require("../utils/storage");
const { findBannedIdentifier, recordIdentifier } = require("../utils/identifiers");
const { banUser, BLOCKED_MESSAGE, IDENTITY_KINDS } = require("../utils/bans");

const router = express.Router();

async function sendKycDecisionEmail({ email, name, storeName, approved, reason }) {
  await sendEmail({
    to: email,
    subject: approved ? "Your VETRA business verification is approved" : "Your VETRA business verification needs attention",
    html: approved
      ? `<p>Hi ${escapeHtml(name)},</p><p><strong>${escapeHtml(storeName)}</strong>'s business verification has been approved automatically. Your verified listings are now visible to buyers.</p>`
      : `<p>Hi ${escapeHtml(name)},</p><p><strong>${escapeHtml(storeName)}</strong>'s verification could not be completed automatically.</p><p>Your submission has been sent for manual review. An administrator will review it and contact you with the outcome.</p><p>You may also update your details and try again from your profile.</p>`,
    logFallback: `${approved ? "KYC approval" : "KYC manual-review"} email for ${email} (${storeName})`,
  });
}

// ---------- Vendor's own payout account ----------
// Backs vendor/earnings.html's Payout Account section. Shared with the
// rider app, see utils/payoutAccount.js.
router.use("/me/payout-account", payoutAccountRouter("vendor"));

// vendor/earnings.html: every order's goods, commission, net and payout.
// Orders placed before online payments (payment_id NULL) were never paid
// through VETRA, so they show with paidOnline: false and no payout.
router.get(
  "/me/earnings",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT o.id, o.tracking_code, o.created_at, o.status, o.escrow_status, o.escrow_released_at, o.total, o.delivery_fee,
              o.payment_id, o.commission_percent, o.commission_amount, o.refunded_amount, d.mode AS delivery_mode,
              p.status AS payout_status, p.amount AS payout_amount, p.completed_at AS payout_completed_at,
              p.failure_reason AS payout_failure_reason
       FROM orders o
       LEFT JOIN deliveries d ON d.order_id = o.id
       LEFT JOIN payouts p ON p.kind = 'vendor' AND p.order_id = o.id
       WHERE o.vendor_id = ? AND o.status <> 'cancelled'
       ORDER BY o.created_at DESC LIMIT 200`,
      [req.user.id]
    );
    const items = rows.map((o) => {
      const commission = o.commission_amount ?? Math.round((o.total * Number(o.commission_percent || 0)) / 100);
      const net = o.total - commission + (o.delivery_mode === "self" ? o.delivery_fee : 0);
      return {
        id: o.id,
        trackingCode: o.tracking_code,
        createdAt: o.created_at,
        status: o.status,
        escrowStatus: o.escrow_status,
        escrowReleasedAt: o.escrow_released_at,
        goods: o.total,
        commissionPercent: Number(o.commission_percent || 0),
        commission,
        net,
        paidOnline: Boolean(o.payment_id),
        payout: o.payout_status
          ? { status: o.payout_status, amount: o.payout_amount, completedAt: o.payout_completed_at, failureReason: o.payout_failure_reason }
          : null,
      };
    });
    const online = items.filter((i) => i.paidOnline);
    res.json({
      stats: {
        totalSales: online.reduce((sum, i) => sum + i.goods, 0),
        paidOut: online.filter((i) => i.payout?.status === "success").reduce((sum, i) => sum + i.payout.amount, 0),
        pending: online.filter((i) => i.payout?.status !== "success").reduce((sum, i) => sum + i.net, 0),
        commission: online.reduce((sum, i) => sum + i.commission, 0),
      },
      items,
    });
  })
);

// ---------- Vendor's own KYC (requires a vendor session) ----------

router.get(
  "/me/kyc",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM vendor_kyc WHERE vendor_id = ?`, [req.user.id]);
    const kyc = rows[0];
    if (!kyc) {
      return res.json({
        status: "not_submitted",
        cacNumber: null,
        idDocumentUrl: null,
        cacDocumentUrl: null,
        submittedAt: null,
        reviewedAt: null,
        rejectionReason: null,
      });
    }
    res.json({
      status: kyc.status,
      cacNumber: kyc.cac_number,
      identityType: kyc.identity_type,
      identityProviderStatus: kyc.identity_provider_status,
      identityProviderMessage: kyc.status === "manual_review" ? "Your submission needs manual review." : kyc.identity_provider_message,
      identityVerifiedAt: kyc.identity_verified_at,
      cacProviderStatus: kyc.cac_provider_status,
      cacProviderMessage: kyc.status === "manual_review" ? "Your submission needs manual review." : kyc.cac_provider_message,
      cacVerifiedAt: kyc.cac_verified_at,
      // Signed, expiring links: the stored URLs can't be opened directly.
      idDocumentUrl: signedUrl(kyc.id_document_url),
      cacDocumentUrl: signedUrl(kyc.cac_document_url),
      submittedAt: kyc.submitted_at,
      reviewedAt: kyc.reviewed_at,
      rejectionReason: kyc.rejection_reason,
    });
  })
);

router.post(
  "/me/kyc/verify",
  requireAuth,
  requireRole("vendor"),
  kycVerifyLimiter,
  asyncHandler(async (req, res) => {
    const identityType = String(req.body.identityType || "").trim();
    const identityNumber = String(req.body.identityNumber || "").trim().toUpperCase();
    const dateOfBirth = String(req.body.dateOfBirth || "").trim();
    // Stored and shown as typed apart from case; IDCheck gets it without
    // spaces or dashes ("RC-123 456" -> "RC123456").
    const cacNumber = String(req.body.cacNumber || "").trim().toUpperCase();
    const cacLookupNumber = cacNumber.replace(/[\s-]/g, "");

    if (!["nin", "bvn", "drivers_license"].includes(identityType)) {
      return res.status(400).json({ error: "Choose NIN, BVN or driver's licence." });
    }
    if (identityType === "nin" && !/^\d{11}$/.test(identityNumber)) {
      return res.status(400).json({ error: "Your NIN is 11 digits." });
    }
    if (identityType === "bvn" && !/^\d{11}$/.test(identityNumber)) {
      return res.status(400).json({ error: "Your BVN is 11 digits." });
    }
    if (identityType === "drivers_license") {
      if (!/^[A-Z0-9-]{6,20}$/.test(identityNumber)) {
        return res.status(400).json({ error: "Enter your licence number as printed, letters and digits only." });
      }
      const dob = new Date(`${dateOfBirth}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(dob.getTime()) || dob >= new Date()) {
        return res.status(400).json({ error: "Enter the date of birth on your licence." });
      }
    }
    if (!/^(RC|BN|IT)\d{4,15}$/.test(cacLookupNumber)) {
      return res.status(400).json({ error: "Enter a valid CAC registration number." });
    }

    const [[vendor]] = await pool.query(
      `SELECT id, first_name, middle_name, last_name, name, email, store_name
       FROM users WHERE id = ? AND role = 'vendor'`,
      [req.user.id]
    );
    if (!vendor) return res.status(404).json({ error: "Vendor not found." });
    if (!vendor.first_name || !vendor.last_name) {
      return res.status(400).json({ error: "Your account has no legal first and last name on file to verify against. Contact VETRA support to add them." });
    }
    const [[previousKyc]] = await pool.query(
      `SELECT status, identity_type, identity_number_enc, cac_number, id_document_url, cac_document_url
       FROM vendor_kyc WHERE vendor_id = ?`,
      [req.user.id]
    );

    // The same NIN/BVN/licence as a banned person means it's them on a new
    // account: that account is banned too. A banned CAC number is refused.
    const bannedMatch = await findBannedIdentifier([[identityType, identityNumber], ["cac", cacLookupNumber]]);
    if (bannedMatch) {
      if (IDENTITY_KINDS.includes(bannedMatch.kind)) {
        await recordIdentifier(req.user.id, identityType, identityNumber);
        await banUser({ userId: req.user.id, matchedBanId: bannedMatch.ban_id, reason: "ID matches a banned account." });
      }
      return res.status(403).json({ error: BLOCKED_MESSAGE });
    }
    await recordIdentifier(req.user.id, identityType, identityNumber);
    await recordIdentifier(req.user.id, "cac", cacLookupNumber);

    if (previousKyc?.status === "manual_review") {
      return res.status(409).json({ error: "Your documents are already in review. You can submit again once the review is done." });
    }
    if (!previousKyc?.id_document_url || !previousKyc?.cac_document_url) {
      return res.status(400).json({ error: "Upload your identity document and CAC certificate before verification." });
    }

    // Each IDCheck.ng result already includes the name match against the
    // vendor's legal name (utils/idcheck.js).
    const legalName = {
      id: vendor.id,
      firstName: vendor.first_name,
      middleName: vendor.middle_name,
      lastName: vendor.last_name,
    };
    let identityResult;
    let cacResult;
    try {
      if (identityType === "nin") identityResult = await verifyNin(identityNumber, legalName);
      else if (identityType === "bvn") identityResult = await verifyBvn(identityNumber, legalName);
      else identityResult = await verifyDriversLicence(identityNumber, dateOfBirth, legalName);
    } catch (error) {
      if (error.statusCode === 503) throw error;
      identityResult = { verified: false, message: error.message };
    }
    if (cacLookupNumber.startsWith("IT")) {
      // IDCheck's CAC lookup covers RC and BN numbers only.
      cacResult = { verified: false, message: "Incorporated trustee (IT) numbers can't be checked automatically." };
    } else {
      try {
        cacResult = await verifyCac(cacLookupNumber, vendor.id);
      } catch (error) {
        if (error.statusCode === 503) throw error;
        cacResult = { verified: false, message: error.message };
      }
    }

    const identityStatus = identityResult.verified ? "verified" : "failed";
    const cacStatus = cacResult.verified ? "verified" : "failed";
    const verificationSucceeded = identityStatus === "verified" && cacStatus === "verified";
    const kycStatus = verificationSucceeded ? "verified" : "manual_review";
    const failureReason = [
      identityStatus !== "verified" ? `Identity: ${identityResult.message}` : null,
      cacStatus !== "verified" ? `CAC: ${cacResult.message}` : null,
    ].filter(Boolean).join(" ");
    await pool.query(
      `INSERT INTO vendor_kyc
       (vendor_id, status, cac_number, identity_type, identity_number_enc,
        identity_provider_status, identity_provider_message, identity_verified_at,
        cac_provider_status, cac_provider_message, cac_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         cac_number = VALUES(cac_number), identity_type = VALUES(identity_type),
         identity_number_enc = VALUES(identity_number_enc),
         identity_provider_status = VALUES(identity_provider_status),
         identity_provider_message = VALUES(identity_provider_message),
         identity_verified_at = VALUES(identity_verified_at),
         cac_provider_status = VALUES(cac_provider_status),
         cac_provider_message = VALUES(cac_provider_message),
         cac_verified_at = VALUES(cac_verified_at)`,
      [
        req.user.id,
        kycStatus,
        cacNumber,
        identityType,
        encrypt(identityNumber),
        identityStatus,
        identityStatus === "verified" ? identityResult.message : failureReason,
        identityStatus === "verified" ? new Date() : null,
        cacStatus,
        cacStatus === "verified" ? cacResult.message : failureReason,
        cacStatus === "verified" ? new Date() : null,
      ]
    );

    const [[settings]] = await pool.query(`SELECT kyc_email_alerts_enabled FROM platform_settings WHERE id = 1`);
    const [admins] = await pool.query(`SELECT id, email, kyc_email_alerts_enabled FROM users WHERE role = 'admin'`);
    let previousIdentityNumber = null;
    if (previousKyc?.identity_number_enc) {
      try {
        previousIdentityNumber = decrypt(previousKyc.identity_number_enc);
      } catch {
        previousIdentityNumber = null;
      }
    }
    const verificationInputsChanged = previousKyc?.identity_type !== identityType
      || previousIdentityNumber !== identityNumber
      || previousKyc?.cac_number !== cacNumber;
    const shouldNotify = !previousKyc || previousKyc.status !== kycStatus || verificationInputsChanged;
    if (verificationSucceeded && shouldNotify) {
      await notify({
        userId: req.user.id,
        type: "kyc",
        title: "Business verification approved",
        message: "Your identity and CAC details were verified. Your listings are now visible to buyers.",
        link: "profile.html",
      });
      await sendKycDecisionEmail({ email: vendor.email, name: vendor.name, storeName: vendor.store_name, approved: true });
    } else if (!verificationSucceeded && shouldNotify) {
      for (const admin of admins) {
        await notify({
          userId: admin.id,
          type: "kyc",
          title: "KYC needs manual review",
          message: `${escapeHtml(vendor.store_name || "A vendor")} needs manual verification review. Detailed diagnostics are available in the admin console.`,
          link: `vendor-detail.html?id=${req.user.id}`,
        });
        if (settings?.kyc_email_alerts_enabled && admin.kyc_email_alerts_enabled) {
          await sendEmail({
            to: admin.email,
            subject: "VETRA: KYC requires manual review",
            html: `<p><strong>${escapeHtml(vendor.store_name || "A vendor")}</strong> failed automatic KYC verification.</p><p><strong>Reason:</strong> ${escapeHtml(failureReason)}</p><p>Review the case from the admin dashboard.</p>`,
            logFallback: `KYC manual-review alert for admin ${admin.email}: ${vendor.store_name}`,
          });
        }
      }
      await notify({
        userId: req.user.id,
        type: "kyc",
        title: "Business verification needs manual review",
        message: "Your verification could not be completed automatically and has been sent for manual review.",
        link: "profile.html",
      });
      await sendKycDecisionEmail({ email: vendor.email, name: vendor.name, storeName: vendor.store_name, approved: false });
    }

    res.status(verificationSucceeded ? 200 : 422).json({
      verified: verificationSucceeded,
      kycStatus,
      reason: failureReason || null,
      ...(verificationSucceeded ? {} : { error: "Your verification could not be completed automatically and needs manual review." }),
      identity: { type: identityType, status: identityStatus, message: identityResult.message },
      cac: { status: cacStatus, message: cacResult.message },
    });
  })
);

router.post(
  "/me/kyc",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const { cacNumber, idDocumentUrl, cacDocumentUrl } = req.body;
    if (!cacNumber || !idDocumentUrl || !cacDocumentUrl) {
      return res.status(400).json({ error: "cacNumber, idDocumentUrl, and cacDocumentUrl are required." });
    }
    // Only documents uploaded through POST /api/uploads (folder "kyc"),
    // stored privately on the server. Earlier submissions on Cloudinary
    // keep working as stored, but every new one is ours.
    for (const documentUrl of [idDocumentUrl, cacDocumentUrl]) {
      if (!privateKeyFromUrl(documentUrl)?.startsWith("kyc/")) {
        return res.status(400).json({ error: "KYC documents must be uploaded through VETRA." });
      }
    }

    const [existing] = await pool.query(
      `SELECT status, cac_number, id_document_url, cac_document_url FROM vendor_kyc WHERE vendor_id = ?`,
      [req.user.id]
    );
    const current = existing[0];
    // A pending submission is locked until it's reviewed, matching
    // vendor/assets/kyc.js's own state machine (DOCUMENTATION.md §6) but
    // enforced here instead of trusted from the client.
    // Manual review is "in review" too: a resubmission would overwrite the
    // documents an admin is looking at.
    if (current && ["pending", "manual_review"].includes(current.status)) {
      return res.status(409).json({ error: "Your documents are already in review. You can submit again once the review is done." });
    }

    // A verified or manual-review decision covers the exact CAC number and
    // documents it was made on. Re-sending the same ones keeps it; changing
    // any of them sends the vendor back to 'pending' (re-run verification,
    // or an admin reviews). Previously a verified vendor could swap in an
    // unchecked CAC number or documents and keep the Verified badge.
    const sameAsDecided = current
      && String(current.cac_number || "").toUpperCase() === String(cacNumber).trim().toUpperCase()
      && current.id_document_url === idDocumentUrl
      && current.cac_document_url === cacDocumentUrl;
    const nextStatus = current && ["verified", "manual_review"].includes(current.status) && sameAsDecided
      ? current.status
      : "pending";

    await pool.query(
      `INSERT INTO vendor_kyc (vendor_id, status, cac_number, id_document_url, cac_document_url, submitted_at, reviewed_at, reviewed_by_user_id, rejection_reason)
       VALUES (?, ?, ?, ?, ?, NOW(), NULL, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status), cac_number = VALUES(cac_number),
         id_document_url = VALUES(id_document_url), cac_document_url = VALUES(cac_document_url),
         submitted_at = NOW(), reviewed_at = NULL, reviewed_by_user_id = NULL, rejection_reason = NULL`,
      [req.user.id, nextStatus, String(cacNumber).trim().toUpperCase(), idDocumentUrl, cacDocumentUrl]
    );

    // Every admin gets the in-app notification (and its unread count)
    // unconditionally, only the email is opt-outable, per-admin
    // (kyc_email_alerts_enabled) and, above that, by the Super
    // Admin-only platform-wide switch (platform_settings.
    // kyc_email_alerts_enabled), see admin.routes.js's PATCH /settings.
    const [[storeRow]] = await pool.query(`SELECT store_name FROM users WHERE id = ?`, [req.user.id]);
    const [[globalSettings]] = await pool.query(`SELECT kyc_email_alerts_enabled FROM platform_settings WHERE id = 1`);
    const [admins] = await pool.query(
      `SELECT id, email, kyc_email_alerts_enabled FROM users WHERE role = 'admin'`
    );
    const storeName = escapeHtml(storeRow?.store_name || "A vendor");
    for (const admin of admins) {
      await notify({
        userId: admin.id,
        type: "kyc",
        title: "New business verification submitted",
        message: `${storeName} submitted business verification documents for review.`,
        link: "vendor-detail.html?id=" + req.user.id,
      });
      if (globalSettings?.kyc_email_alerts_enabled && admin.kyc_email_alerts_enabled) {
        await sendEmail({
          to: admin.email,
          subject: "VETRA: new vendor KYC submission",
          html: `<p><strong>${storeName}</strong> just submitted business verification documents for review.</p><p>Review it from the admin console's Vendors page.</p>`,
          logFallback: `KYC submission alert for admin ${admin.email}: ${storeName}`,
        });
      }
    }

    res.status(201).json({ status: nextStatus, submittedAt: new Date().toISOString() });
  })
);

// ---------- Public directory ----------

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    // Table-prefixed, the vendor_kyc join below adds its own `status`
    // column, which would otherwise make an unprefixed `status` ambiguous.
    const clauses = ["u.role = 'vendor'", "u.status = 'active'"];
    const params = [];
    if (q) {
      clauses.push("u.store_name LIKE ?");
      params.push(`%${q}%`);
    }

    // kyc_verified: whether this vendor's ID/CAC documents have actually
    // been reviewed and approved (vendor_kyc.status = 'verified'), a
    // distinct, separate thing from being approved to sell at all
    // (users.status = 'active', already required by this query's WHERE).
    // A vendor can be selling live without ever having passed KYC,
    // the storefront's "Verified" badge must reflect the real KYC
    // outcome, not just "this account is approved."
    const [rows] = await pool.query(
      `SELECT u.id, u.store_name, u.avatar_url, u.store_cover_url, u.store_category, u.status, u.address,
              COALESCE(AVG(r.rating), 0) AS rating, COUNT(r.id) AS review_count,
              COALESCE(vk.status = 'verified', 0) AS kyc_verified
       FROM users u LEFT JOIN reviews r ON r.vendor_id = u.id
       LEFT JOIN vendor_kyc vk ON vk.vendor_id = u.id
      WHERE ${clauses.join(" AND ")}
       GROUP BY u.id ORDER BY u.store_name ASC LIMIT 200`, // safety-net cap, not real pagination
      params
    );
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT u.id, u.store_name, u.avatar_url, u.store_cover_url, u.store_category, u.store_description, u.address,
              u.created_at AS member_since, u.status,
              COALESCE(AVG(r.rating), 0) AS rating, COUNT(r.id) AS review_count,
              (SELECT COUNT(*) FROM products p WHERE p.vendor_id = u.id AND p.status = 'active') AS products_count,
              (SELECT COUNT(*) FROM orders o WHERE o.vendor_id = u.id) AS orders_count,
              COALESCE(vk.status = 'verified', 0) AS kyc_verified
       FROM users u LEFT JOIN reviews r ON r.vendor_id = u.id
       LEFT JOIN vendor_kyc vk ON vk.vendor_id = u.id
      WHERE u.id = ? AND u.role = 'vendor' AND u.status = 'active'
       GROUP BY u.id`,
      [req.params.id]
    );
    // Same "don't distinguish doesn't-exist from exists-but-suspended"
    // reasoning as the auth error messages, see BACKEND_GUIDE.md §4.
    if (!rows[0]) return res.status(404).json({ error: "Vendor not found." });
    res.json(rows[0]);
  })
);

module.exports = router;
