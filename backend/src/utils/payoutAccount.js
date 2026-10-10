/* =========================================================
   A user's own payout bank account: the account automatic payouts
   (utils/payments.js) are sent to. One router, mounted for vendors at
   /api/vendors/me/payout-account (vendor/earnings.html) and for riders
   at /api/delivery/rider/payout-account (rider/index.html):

     GET  /banks    the searchable bank dropdown (Paystack, cached)
     GET  /resolve  bank code + NUBAN -> the bank-registered name, so the
                    form can ask "is this you?" before saving
     GET  /         the saved account, number masked
     PUT  /         save it. The name is always resolved server-side,
                    never taken from the client.

   The account number is AES-256-GCM encrypted at rest and never
   returned in full. Saving a new account clears the cached Paystack
   transfer recipient and sends any payouts that were only waiting for
   an account.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("./asyncHandler");
const { encrypt, decrypt } = require("./encryption");
const { listBanks, resolveAccountNumber } = require("./paystack");
const { newId } = require("./id");

function maskAccountNumber(number) {
  return `•••• ${number.slice(-4)}`;
}

function payoutAccountRouter(role) {
  const router = express.Router();
  router.use(requireAuth, requireRole(role));

  router.get(
    "/banks",
    asyncHandler(async (req, res) => {
      res.json(await listBanks());
    })
  );

  router.get(
    "/resolve",
    asyncHandler(async (req, res) => {
      const { accountNumber, bankCode } = req.query;
      if (!accountNumber || !bankCode) {
        return res.status(400).json({ error: "accountNumber and bankCode are required." });
      }
      if (!/^\d{10}$/.test(String(accountNumber).trim())) {
        return res.status(400).json({ error: "accountNumber must be exactly 10 digits (a NUBAN)." });
      }
      try {
        res.json(await resolveAccountNumber(String(accountNumber).trim(), String(bankCode).trim()));
      } catch (err) {
        res.status(422).json({ error: err.message });
      }
    })
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const [[row]] = await pool.query(
        `SELECT payout_bank_name, payout_bank_code, payout_account_number_enc, payout_account_name FROM users WHERE id = ?`,
        [req.user.id]
      );
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
    "/",
    asyncHandler(async (req, res) => {
      const { bankName, bankCode } = req.body;
      const accountNumber = String(req.body.accountNumber || "").trim();
      if (!bankName || !bankCode || !accountNumber) {
        return res.status(400).json({ error: "bankName, bankCode, and accountNumber are required." });
      }
      if (!/^\d{10}$/.test(accountNumber)) {
        return res.status(400).json({ error: "accountNumber must be exactly 10 digits (a NUBAN)." });
      }

      let resolved;
      try {
        resolved = await resolveAccountNumber(accountNumber, String(bankCode).trim());
      } catch (err) {
        return res.status(422).json({ error: err.message });
      }

      const maskedAccountNumber = maskAccountNumber(accountNumber);
      const [[current]] = await pool.query(`SELECT payout_account_number_enc FROM users WHERE id = ?`, [req.user.id]);
      if (current?.payout_account_number_enc) {
        await pool.query(
          `UPDATE vendor_payout_account_history SET unlinked_at = NOW() WHERE vendor_id = ? AND unlinked_at IS NULL`,
          [req.user.id]
        );
      }
      await pool.query(
        `UPDATE users SET payout_bank_name = ?, payout_bank_code = ?, payout_account_number_enc = ?,
           payout_account_name = ?, paystack_recipient_code = NULL
         WHERE id = ?`,
        [bankName, bankCode, encrypt(accountNumber), resolved.accountName, req.user.id]
      );
      // The table predates riders; vendor_id is just the account holder's user id.
      await pool.query(
        `INSERT INTO vendor_payout_account_history
         (id, vendor_id, bank_name, bank_code, account_name, masked_account_number)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId(), req.user.id, bankName, bankCode, resolved.accountName, maskedAccountNumber]
      );
      // Required lazily: payments.js pulls in most of the backend.
      await require("./payments").processPendingPayoutsForUser(req.user.id);

      res.json({ isSet: true, bankName, bankCode, maskedAccountNumber, accountName: resolved.accountName });
    })
  );

  return router;
}

module.exports = { payoutAccountRouter, maskAccountNumber };
