-- Vendors can verify with a voter's card too (utils/prembly.js
-- verifyVotersCard), like riders. Existing rows keep their values.
ALTER TABLE vendor_kyc
  MODIFY COLUMN identity_type ENUM('nin', 'bvn', 'drivers_license', 'voters_card') NULL;
