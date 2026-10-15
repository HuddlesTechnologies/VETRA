-- Riders can now sign up themselves (rider/signup.html). A self-signed-up
-- rider starts 'pending' and becomes 'active' once their NIN, driver's
-- licence or voter's card passes a Prembly check (src/utils/prembly.js)
-- or an admin approves them. Riders an admin adds stay 'active' as before.
-- The ID number is encrypted like vendor_kyc.identity_number_enc; provider
-- payloads are never stored.
ALTER TABLE users
  ADD COLUMN rider_identity_type ENUM('nin', 'drivers_license', 'voters_card') NULL AFTER rider_on_duty,
  ADD COLUMN rider_identity_number_enc VARCHAR(500) NULL AFTER rider_identity_type,
  ADD COLUMN rider_identity_status ENUM('not_submitted', 'verified', 'failed') NOT NULL DEFAULT 'not_submitted' AFTER rider_identity_number_enc,
  ADD COLUMN rider_identity_message VARCHAR(500) NULL AFTER rider_identity_status,
  ADD COLUMN rider_identity_verified_at DATETIME NULL AFTER rider_identity_message;

-- Voter's card numbers join the identifiers bans match on.
ALTER TABLE user_identifiers
  MODIFY COLUMN kind ENUM('email', 'phone', 'device', 'nin', 'bvn', 'drivers_license', 'voters_card', 'cac', 'bank_account', 'card') NOT NULL;
ALTER TABLE banned_identifiers
  MODIFY COLUMN kind ENUM('email', 'phone', 'device', 'nin', 'bvn', 'drivers_license', 'voters_card', 'cac', 'bank_account', 'card') NOT NULL;
