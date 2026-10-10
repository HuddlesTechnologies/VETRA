-- KYC moved from CheckID.ng to IDCheck.ng (src/utils/idcheck.js), which
-- adds BVN as a third identity option. Existing rows keep their values.
ALTER TABLE vendor_kyc
  MODIFY COLUMN identity_type ENUM('nin', 'bvn', 'drivers_license') NULL;
