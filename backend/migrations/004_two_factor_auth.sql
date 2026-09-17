-- =========================================================
-- VETRA — TWO-FACTOR AUTHENTICATION (email one-time code)
--
-- Backs the "Two-factor authentication" toggle on admin/settings.html
-- and vendor/profile.html (buyer accounts have no such toggle, so
-- two_factor_enabled only ever gets set true on an admin/vendor row —
-- nothing enforces that at the schema level, same "nullable/unused by
-- role" precedent as admin_role, store_name, etc. on this table).
--
-- Email, not an authenticator app — this deployment already has a
-- working transactional-email path (src/utils/mailer.js, used for
-- password resets and KYC alerts) and no TOTP/SMS infrastructure, so
-- reusing that is a real, working second factor rather than an
-- authenticator-app flow this app can't actually ship yet.
-- =========================================================

ALTER TABLE users
  ADD COLUMN two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- One active code per user at a time in practice (a fresh sign-in or
-- "Resend code" click invalidates any earlier unconsumed row for that
-- user — see src/routes/auth.routes.js) — old rows are kept rather
-- than deleted, both as an audit trail and so `attempts` on an
-- already-superseded code can't be reset by requesting a new one.
CREATE TABLE IF NOT EXISTS two_factor_codes (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME,
  -- Wrong-guess counter for THIS code only — capped server-side
  -- (5 tries) so a 6-digit code (1-in-1,000,000) can't be brute-forced
  -- by hammering /auth/2fa/verify; a new code via /auth/2fa/resend
  -- starts its own fresh counter on a new row.
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_two_factor_codes_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
