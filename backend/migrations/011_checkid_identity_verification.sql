-- CheckID.ng identity verification metadata. Identity numbers are encrypted
-- before storage; provider payloads are intentionally not persisted because
-- they may contain sensitive identity and biometric data.
ALTER TABLE vendor_kyc
  ADD COLUMN identity_type ENUM('nin', 'drivers_license') NULL AFTER cac_number,
  ADD COLUMN identity_number_enc VARCHAR(500) NULL AFTER identity_type,
  ADD COLUMN identity_provider_status ENUM('not_checked', 'verified', 'failed') NOT NULL DEFAULT 'not_checked' AFTER identity_number_enc,
  ADD COLUMN identity_provider_message VARCHAR(500) NULL AFTER identity_provider_status,
  ADD COLUMN identity_verified_at DATETIME NULL AFTER identity_provider_message,
  ADD COLUMN cac_provider_status ENUM('not_checked', 'verified', 'failed') NOT NULL DEFAULT 'not_checked' AFTER identity_verified_at,
  ADD COLUMN cac_provider_message VARCHAR(500) NULL AFTER cac_provider_status,
  ADD COLUMN cac_verified_at DATETIME NULL AFTER cac_provider_message;
