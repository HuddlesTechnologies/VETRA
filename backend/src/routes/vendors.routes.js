/* =========================================================
   /api/vendors — public vendor directory (customer/vendors.html's
   search, customer/store.html's storefront) plus a vendor's own
   Business Verification (KYC) submission — see BACKEND_GUIDE.md §5.

   `/me/kyc` is declared before `/:id` so "me" is never swallowed by
   the `:id` param route — Express matches in declaration order, and
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
const { listBanks, resolveAccountNumber } = require("../utils/paystack");
const { newId } = require("../utils/id");
const { verifyNin, verifyDriversLicense, verifyCac, normalizeName } = require("../utils/checkid");

const router = express.Router();

function maskAccountNumber(number) {
  return `•••• ${number.slice(-4)}`;
}

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
// Backs vendor/earnings.html's Payout Account section — see
// BACKEND_GUIDE.md §3's note on why the account number is encrypted
// at rest and never returned in full once saved.

// The searchable bank dropdown's options (Paystack's Miscellaneous API,
// cached in src/utils/paystack.js — this endpoint just needs a vendor
// session, same as the account itself, rather than being public).
router.get(
  "/me/payout-account/banks",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    res.json(await listBanks());
  })
);

// Resolves a bank code + NUBAN to the real, bank-registered account
// name *before* saving — lets the form show the vendor "is this you?"
// instead of them typing a name that PUT below would just trust blind.
router.get(
  "/me/payout-account/resolve",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const { accountNumber, bankCode } = req.query;
    if (!accountNumber || !bankCode) {
      return res.status(400).json({ error: "accountNumber and bankCode are required." });
    }
    if (!/^\d{10}$/.test(String(accountNumber).trim())) {
      return res.status(400).json({ error: "accountNumber must be exactly 10 digits (a NUBAN)." });
    }
    try {
      const resolved = await resolveAccountNumber(String(accountNumber).trim(), String(bankCode).trim());
      res.json(resolved);
    } catch (err) {
      res.status(422).json({ error: err.message });
    }
  })
);

router.get(
  "/me/payout-account",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT payout_bank_name, payout_bank_code, payout_account_number_enc, payout_account_name FROM users WHERE id = ?`,
      [req.user.id]
    );
    const row = rows[0];
    if (!row || !row.payout_account_number_enc) {
      return res.json({ isSet: false, bankName: null, bankCode: null, maskedAccountNumber: null, accountName: null });
    }
    res.json({
      isSet: true,
      bankName: row.payout_bank_name,
      bankCode: row.payout_bank_code,
      maskedAccountNumber: maskAccountNumber(decrypt(row.payout_account_number_enc)),
      accountName: row.payout_account_name,
    });
  })
);

router.put(
  "/me/payout-account",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const { bankName, bankCode, accountNumber } = req.body;
    if (!bankName || !bankCode || !accountNumber) {
      return res.status(400).json({ error: "bankName, bankCode, and accountNumber are required." });
    }
    if (!/^\d{10}$/.test(String(accountNumber).trim())) {
      return res.status(400).json({ error: "accountNumber must be exactly 10 digits (a NUBAN)." });
    }

    // The account name is never taken from the client — resolved fresh
    // against Paystack here, the same call /me/payout-account/resolve
    // makes for the form's live preview, so what gets saved is always
    // the real bank-registered name, not whatever the request claims.
    let resolved;
    try {
      resolved = await resolveAccountNumber(String(accountNumber).trim(), String(bankCode).trim());
    } catch (err) {
      return res.status(422).json({ error: err.message });
    }

    const encrypted = encrypt(String(accountNumber).trim());
    const maskedAccountNumber = maskAccountNumber(String(accountNumber).trim());
    const [[currentAccount]] = await pool.query(
      `SELECT payout_bank_name, payout_bank_code, payout_account_number_enc, payout_account_name
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (currentAccount?.payout_account_number_enc) {
      await pool.query(
        `UPDATE vendor_payout_account_history SET unlinked_at = NOW()
         WHERE vendor_id = ? AND unlinked_at IS NULL`,
        [req.user.id]
      );
    }
    await pool.query(
      `UPDATE users SET payout_bank_name = ?, payout_bank_code = ?, payout_account_number_enc = ?, payout_account_name = ? WHERE id = ?`,
      [bankName, bankCode, encrypted, resolved.accountName, req.user.id]
    );
    await pool.query(
      `INSERT INTO vendor_payout_account_history
       (id, vendor_id, bank_name, bank_code, account_name, masked_account_number)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), req.user.id, bankName, bankCode, resolved.accountName, maskedAccountNumber]
    );
    res.json({
      isSet: true,
      bankName,
      bankCode,
      maskedAccountNumber,
      accountName: resolved.accountName,
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
      idDocumentUrl: kyc.id_document_url,
      cacDocumentUrl: kyc.cac_document_url,
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
  asyncHandler(async (req, res) => {
    const identityType = String(req.body.identityType || "").trim();
    const identityNumber = String(req.body.identityNumber || "").trim();
    const cacNumber = String(req.body.cacNumber || "").trim().toUpperCase();

    if (!["nin", "drivers_license"].includes(identityType)) {
      return res.status(400).json({ error: "Choose NIN or driver's licence." });
    }
    if (!/^[A-Za-z0-9-]{8,30}$/.test(identityNumber)) {
      return res.status(400).json({ error: "Enter a valid identity number." });
    }
    if (!/^(RC|BN|IT)\s?-?\d{5,15}$/i.test(cacNumber)) {
      return res.status(400).json({ error: "Enter a valid CAC registration number." });
    }

    const [[vendor]] = await pool.query(
      `SELECT first_name, middle_name, last_name, name, email, store_name
       FROM users WHERE id = ? AND role = 'vendor'`,
      [req.user.id]
    );
    if (!vendor) return res.status(404).json({ error: "Vendor not found." });
    const [[previousKyc]] = await pool.query(
      `SELECT status, identity_type, identity_number_enc, cac_number, id_document_url, cac_document_url
       FROM vendor_kyc WHERE vendor_id = ?`,
      [req.user.id]
    );

    if (!previousKyc?.id_document_url || !previousKyc?.cac_document_url) {
      return res.status(400).json({ error: "Upload your identity document and CAC certificate before verification." });
    }

    let identityResult;
    let cacResult;
    try {
      identityResult = identityType === "nin"
        ? await verifyNin(identityNumber)
        : await verifyDriversLicense(identityNumber, vendor.first_name, vendor.last_name);
    } catch (error) {
      if (error.statusCode === 503) throw error;
      identityResult = { verified: false, message: error.message };
    }
    try {
      cacResult = await verifyCac(cacNumber);
    } catch (error) {
      if (error.statusCode === 503) throw error;
      cacResult = { verified: false, message: error.message };
    }

    const providerName = identityResult.identityName || {};
    const nameMatches = identityResult.verified
      && normalizeName(providerName.firstName) === normalizeName(vendor.first_name)
      && normalizeName(providerName.lastName) === normalizeName(vendor.last_name)
      && (!vendor.middle_name || normalizeName(providerName.middleName) === normalizeName(vendor.middle_name));
    if (identityResult.verified && !nameMatches) {
      identityResult.message = "The name on the identity document does not match the vendor name.";
    }
    const identityStatus = identityResult.verified && nameMatches ? "verified" : "failed";
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
    for (const documentUrl of [idDocumentUrl, cacDocumentUrl]) {
      let parsed;
      try {
        parsed = new URL(documentUrl);
      } catch {
        return res.status(400).json({ error: "KYC documents must be uploaded through VETRA." });
      }
      if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com" || !parsed.pathname.includes("/authenticated/")) {
        return res.status(400).json({ error: "KYC documents must be uploaded through VETRA." });
      }
    }

    const [existing] = await pool.query(`SELECT status FROM vendor_kyc WHERE vendor_id = ?`, [req.user.id]);
    // A manual-review or automatically verified provider result can still
    // receive the uploaded documents; preserve that provider decision while
    // storing the files needed for admin review and customer visibility.
    // Only other pending submissions are locked from replacement.
    // by resubmitting, matching vendor/assets/kyc.js's own state machine
    // (DOCUMENTATION.md §6) but enforced here instead of trusted from the client.
    if (existing[0] && !["not_submitted", "rejected", "manual_review", "verified"].includes(existing[0].status)) {
      return res.status(400).json({ error: `Can't submit while status is '${existing[0].status}'.` });
    }

    await pool.query(
      `INSERT INTO vendor_kyc (vendor_id, status, cac_number, id_document_url, cac_document_url, submitted_at, reviewed_at, reviewed_by_user_id, rejection_reason)
       VALUES (?, ?, ?, ?, ?, NOW(), NULL, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         status = IF(status IN ('verified', 'manual_review'), status, 'pending'), cac_number = VALUES(cac_number),
         id_document_url = VALUES(id_document_url), cac_document_url = VALUES(cac_document_url),
         submitted_at = NOW(), reviewed_at = NULL, reviewed_by_user_id = NULL, rejection_reason = NULL`,
      [req.user.id, existing[0]?.status === "verified" ? "verified" : existing[0]?.status === "manual_review" ? "manual_review" : "pending", cacNumber, idDocumentUrl, cacDocumentUrl]
    );

    // Every admin gets the in-app notification (and its unread count)
    // unconditionally — only the email is opt-outable, per-admin
    // (kyc_email_alerts_enabled) and, above that, by the Super
    // Admin-only platform-wide switch (platform_settings.
    // kyc_email_alerts_enabled) — see admin.routes.js's PATCH /settings.
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

    res.status(201).json({ status: existing[0]?.status === "verified" ? "verified" : existing[0]?.status === "manual_review" ? "manual_review" : "pending", submittedAt: new Date().toISOString() });
  })
);

// ---------- Public directory ----------

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    // Table-prefixed — the vendor_kyc join below adds its own `status`
    // column, which would otherwise make an unprefixed `status` ambiguous.
    const clauses = ["u.role = 'vendor'", "(u.status = 'active' OR vk.status = 'verified')"];
    const params = [];
    if (q) {
      clauses.push("u.store_name LIKE ?");
      params.push(`%${q}%`);
    }

    // kyc_verified: whether this vendor's ID/CAC documents have actually
    // been reviewed and approved (vendor_kyc.status = 'verified') — a
    // distinct, separate thing from being approved to sell at all
    // (users.status = 'active', already required by this query's WHERE).
    // A vendor can be selling live without ever having passed KYC —
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
      WHERE u.id = ? AND u.role = 'vendor' AND (u.status = 'active' OR (vk.status = 'verified' AND vk.id_document_url IS NOT NULL AND vk.cac_document_url IS NOT NULL))
       GROUP BY u.id`,
      [req.params.id]
    );
    // Same "don't distinguish doesn't-exist from exists-but-suspended"
    // reasoning as the auth error messages — see BACKEND_GUIDE.md §4.
    if (!rows[0]) return res.status(404).json({ error: "Vendor not found." });
    res.json(rows[0]);
  })
);

module.exports = router;
