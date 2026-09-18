-- =========================================================
-- VETRA - server-side idle session tracking
--
-- last_activity_at is updated by the auth middleware after a valid
-- authenticated request and is used to enforce SESSION_IDLE_TIMEOUT_MINUTES.
-- NULL is allowed so existing users and tokens can be upgraded without
-- forcing a logout when this migration is first deployed.
-- =========================================================

ALTER TABLE users
  ADD COLUMN last_activity_at DATETIME NULL AFTER last_login_at;