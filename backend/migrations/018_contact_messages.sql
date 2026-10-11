-- Messages sent from the public contact form (contact.html), read and
-- answered from the admin console (admin/messages.html).

CREATE TABLE IF NOT EXISTS contact_messages (
  id CHAR(36) PRIMARY KEY,
  sender_type ENUM('buyer', 'vendor') NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  topic VARCHAR(120) NULL,
  order_ref VARCHAR(40) NULL,
  business_name VARCHAR(120) NULL,
  message TEXT NOT NULL,
  status ENUM('new', 'replied', 'closed') NOT NULL DEFAULT 'new',
  reply TEXT NULL,
  replied_by_user_id CHAR(36) NULL,
  replied_at DATETIME NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_contact_status (status, created_at),
  FOREIGN KEY (replied_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE notifications
  MODIFY COLUMN type ENUM('order', 'kyc', 'vendor_status', 'account', 'report', 'low_stock', 'delivery', 'contact') NOT NULL;

ALTER TABLE activity_log
  MODIFY COLUMN type ENUM('account', 'vendor', 'report', 'order', 'login', 'delivery', 'contact') NOT NULL;
