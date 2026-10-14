-- A Super Admin can cancel a payout that hasn't gone through (failed,
-- scheduled, or waiting on a bank account) instead of only retrying it,
-- e.g. when the vendor or rider was paid another way or isn't owed it.
-- A cancelled payout is never sent or retried by the sweep.

ALTER TABLE payouts
  MODIFY COLUMN status ENUM('awaiting_account', 'queued', 'processing', 'success', 'failed', 'reversed', 'cancelled') NOT NULL DEFAULT 'queued',
  ADD COLUMN cancel_reason VARCHAR(255) NULL AFTER failure_reason,
  ADD COLUMN cancelled_by_user_id CHAR(36) NULL AFTER cancel_reason,
  ADD COLUMN cancelled_at DATETIME NULL AFTER completed_at,
  ADD CONSTRAINT fk_payouts_cancelled_by FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
