-- =========================================================
-- VETRA - low stock vendor notifications
-- =========================================================

ALTER TABLE notifications
  MODIFY COLUMN type ENUM('order', 'kyc', 'vendor_status', 'account', 'report', 'low_stock') NOT NULL;
