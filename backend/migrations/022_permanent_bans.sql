-- Permanent bans (utils/bans.js). A ban covers the person, not just
-- the account: everything known to identify them (email, phone, devices,
-- NIN/BVN/licence, CAC number, payout bank account, card) is copied into
-- banned_identifiers, and signup, KYC, payout setup, checkout and every
-- API request check it.
--
-- user_identifiers is the running record of those identifiers for every
-- account, which is also how linked accounts (the same phone, card or
-- device on two accounts) are found. Values are stored only as keyed
-- hashes (HMAC with ENCRYPTION_KEY), never readable.

ALTER TABLE users
  MODIFY COLUMN status ENUM('active', 'suspended', 'pending', 'rejected', 'deleted', 'banned') NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS user_identifiers (
  user_id CHAR(36) NOT NULL,
  kind ENUM('email', 'phone', 'device', 'nin', 'bvn', 'drivers_license', 'cac', 'bank_account', 'card') NOT NULL,
  value_hash CHAR(64) NOT NULL,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, kind, value_hash),
  INDEX idx_identifier_value (kind, value_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_bans (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  reason VARCHAR(255) NULL,
  banned_by_user_id CHAR(36) NULL,
  -- Set when the ban was applied automatically (the person came back
  -- with a banned NIN/BVN): the ban it was matched against.
  matched_ban_id CHAR(36) NULL,
  previous_status VARCHAR(20) NOT NULL,
  -- A vendor's listings the ban took down, so lifting it relists exactly
  -- those and not ones the vendor had removed themselves.
  delisted_product_ids JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lifted_at DATETIME NULL,
  lifted_by_user_id CHAR(36) NULL,
  INDEX idx_user_bans_user (user_id, lifted_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (banned_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (lifted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS banned_identifiers (
  kind ENUM('email', 'phone', 'device', 'nin', 'bvn', 'drivers_license', 'cac', 'bank_account', 'card') NOT NULL,
  value_hash CHAR(64) NOT NULL,
  ban_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, value_hash),
  INDEX idx_banned_identifiers_ban (ban_id),
  FOREIGN KEY (ban_id) REFERENCES user_bans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Paystack's card fingerprint (authorization.signature): the same card
-- gives the same value on any account, so a banned buyer's card is
-- recognised on a new account at checkout.
ALTER TABLE payments
  ADD COLUMN card_signature VARCHAR(100) NULL AFTER channel;

ALTER TABLE activity_log
  MODIFY COLUMN type ENUM('account', 'vendor', 'report', 'order', 'login', 'delivery', 'contact', 'ban') NOT NULL;
