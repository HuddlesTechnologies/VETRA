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

const router = express.Router();

function maskAccountNumber(number) {
  return `•••• ${number.slice(-4)}`;
}

// ---------- Vendor's own payout account ----------
// Backs vendor/earnings.html's Payout Account section — see
// BACKEND_GUIDE.md §3's note on why the account number is encrypted
// at rest and never returned in full once saved.

router.get(
  "/me/payout-account",
  requireAuth,
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT payout_bank_name, payout_account_number_enc, payout_account_name FROM users WHERE id = ?`,
      [req.user.id]
    );
    const row = rows[0];
    if (!row || !row.payout_account_number_enc) {
      return res.json({ isSet: false, bankName: null, maskedAccountNumber: null, accountName: null });
    }
    res.json({
      isSet: true,
      bankName: row.payout_bank_name,
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
    const { bankName, accountNumber, accountName } = req.body;
    if (!bankName || !accountNumber || !accountName) {
      return res.status(400).json({ error: "bankName, accountNumber, and accountName are required." });
    }
    if (!/^\d{10}$/.test(String(accountNumber).trim())) {
      return res.status(400).json({ error: "accountNumber must be exactly 10 digits (a NUBAN)." });
    }

    const encrypted = encrypt(String(accountNumber).trim());
    await pool.query(
      `UPDATE users SET payout_bank_name = ?, payout_account_number_enc = ?, payout_account_name = ? WHERE id = ?`,
      [bankName, encrypted, accountName, req.user.id]
    );
    res.json({
      isSet: true,
      bankName,
      maskedAccountNumber: maskAccountNumber(String(accountNumber).trim()),
      accountName,
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
      idDocumentUrl: kyc.id_document_url,
      cacDocumentUrl: kyc.cac_document_url,
      submittedAt: kyc.submitted_at,
      reviewedAt: kyc.reviewed_at,
      rejectionReason: kyc.rejection_reason,
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

    const [existing] = await pool.query(`SELECT status FROM vendor_kyc WHERE vendor_id = ?`, [req.user.id]);
    // Only allowed to (re)submit from not_submitted or rejected — a
    // pending or already-verified submission can't be silently overwritten
    // by resubmitting, matching vendor/assets/kyc.js's own state machine
    // (DOCUMENTATION.md §6) but enforced here instead of trusted from the client.
    if (existing[0] && !["not_submitted", "rejected"].includes(existing[0].status)) {
      return res.status(400).json({ error: `Can't submit while status is '${existing[0].status}'.` });
    }

    await pool.query(
      `INSERT INTO vendor_kyc (vendor_id, status, cac_number, id_document_url, cac_document_url, submitted_at, reviewed_at, reviewed_by_user_id, rejection_reason)
       VALUES (?, 'pending', ?, ?, ?, NOW(), NULL, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         status = 'pending', cac_number = VALUES(cac_number),
         id_document_url = VALUES(id_document_url), cac_document_url = VALUES(cac_document_url),
         submitted_at = NOW(), reviewed_at = NULL, reviewed_by_user_id = NULL, rejection_reason = NULL`,
      [req.user.id, cacNumber, idDocumentUrl, cacDocumentUrl]
    );
    res.status(201).json({ status: "pending", submittedAt: new Date().toISOString() });
  })
);

// ---------- Public directory ----------

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    // Table-prefixed — the vendor_kyc join below adds its own `status`
    // column, which would otherwise make an unprefixed `status` ambiguous.
    const clauses = ["u.role = 'vendor'", "u.status = 'active'"];
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
       GROUP BY u.id ORDER BY u.store_name ASC`,
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
    // reasoning as the auth error messages — see BACKEND_GUIDE.md §4.
    if (!rows[0]) return res.status(404).json({ error: "Vendor not found." });
    res.json(rows[0]);
  })
);

module.exports = router;
