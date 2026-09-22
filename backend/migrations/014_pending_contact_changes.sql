-- =========================================================
-- VETRA — ADMIN-INITIATED EMAIL CHANGES (OTP on the new address)
--
-- Backs POST /api/admin/customers|vendors/:id/email and its /verify
-- companion. A Super Admin/Moderator enters a new email for a
-- customer/vendor; a code is emailed to that NEW address to prove
-- someone there actually controls it, and the admin (having gotten
-- the code back through a support channel — call, chat, ticket, not
-- a customer-facing page this app doesn't have) enters it in the
-- same admin panel to finalize the change. Same shape as
-- two_factor_codes (migrations/004_two_factor_auth.sql) — code_hash/
-- expires_at/attempts/consumed_at — plus the pending new_email itself
-- and which admin requested it, for the activity trail.
-- =========================================================

CREATE TABLE IF NOT EXISTS pending_email_changes (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  new_email VARCHAR(190) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  requested_by_admin_id CHAR(36) NOT NULL,
  -- Wrong-guess counter for THIS pending change only — capped
  -- server-side (5 tries) same as two_factor_codes, so a 6-digit code
  -- can't be brute-forced by hammering the /verify endpoint.
  attempts INT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_admin_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_pending_email_changes_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
