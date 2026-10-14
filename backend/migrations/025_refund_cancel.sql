-- A Super Admin can cancel a failed refund instead of only retrying it,
-- e.g. when the buyer was refunded outside VETRA or the refund was a
-- mistake. Its amount stops counting as refunded on the order
-- (orders.refunded_amount), so the order can be refunded again later.

ALTER TABLE refunds
  MODIFY COLUMN status ENUM('processing', 'processed', 'failed', 'cancelled') NOT NULL DEFAULT 'processing',
  ADD COLUMN cancel_reason VARCHAR(255) NULL AFTER failure_reason,
  ADD COLUMN cancelled_by_user_id CHAR(36) NULL AFTER cancel_reason,
  ADD COLUMN cancelled_at DATETIME NULL AFTER completed_at,
  ADD CONSTRAINT fk_refunds_cancelled_by FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
