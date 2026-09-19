-- =========================================================
-- VETRA - admin audit details
--
-- Keep the current login IP on users for quick admin visibility and retain
-- every successful login in a small history table for audit review.
-- Payout history intentionally stores only masked account numbers; the
-- encrypted account number remains on users and is never exposed to admins.
-- =========================================================

ALTER TABLE users
  ADD COLUMN last_login_ip VARCHAR(45) NULL AFTER last_login_at;

CREATE TABLE IF NOT EXISTS login_ip_history (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_login_ip_history_user_time (user_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vendor_payout_account_history (
  id CHAR(36) PRIMARY KEY,
  vendor_id CHAR(36) NOT NULL,
  bank_name VARCHAR(120) NOT NULL,
  bank_code VARCHAR(30) NOT NULL,
  account_name VARCHAR(160) NOT NULL,
  masked_account_number VARCHAR(30) NOT NULL,
  linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unlinked_at DATETIME NULL,
  FOREIGN KEY (vendor_id) REFERENCES users(id),
  INDEX idx_vendor_payout_history_vendor_time (vendor_id, linked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
