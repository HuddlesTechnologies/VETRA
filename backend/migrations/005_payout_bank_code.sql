-- =========================================================
-- VETRA — payout bank code (Paystack)
--
-- The Paystack bank code (not the display name) a payout account's
-- bank actually resolves against — see src/utils/paystack.js and
-- vendors.routes.js's PUT/GET /me/payout-account. Needed to re-resolve
-- or, eventually, actually pay out through Paystack's Transfer API
-- (not built yet — same "no real payment gateway integrated" caveat
-- as migrations/003_order_item_availability.sql); payout_bank_name
-- alone was never enough to call Paystack back with.
-- =========================================================

ALTER TABLE users
  ADD COLUMN payout_bank_code VARCHAR(10) NULL AFTER payout_bank_name;
