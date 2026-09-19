-- A provider failure is distinct from a normal pending document review:
-- it needs an admin decision with the provider's reason visible.
ALTER TABLE vendor_kyc
  MODIFY COLUMN status ENUM('not_submitted', 'pending', 'manual_review', 'verified', 'rejected') NOT NULL DEFAULT 'not_submitted';
