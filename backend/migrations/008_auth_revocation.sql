-- =========================================================
-- VETRA - authentication revocation state
--
-- Incrementing session_version invalidates every previously issued token
-- for the account. The auth middleware also reads the current status and
-- admin role on every request, so suspensions and role changes take effect
-- immediately rather than waiting for JWT expiry.
-- =========================================================

ALTER TABLE users
  ADD COLUMN session_version INT NOT NULL DEFAULT 0 AFTER last_activity_at;
