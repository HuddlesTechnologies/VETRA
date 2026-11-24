-- Social media links shown in the public site footer, managed by Super
-- Admins from admin/settings.html (Social Media card) through
-- /api/social-links. Any number of networks, in display order.

CREATE TABLE IF NOT EXISTS social_links (
  id CHAR(36) PRIMARY KEY,
  label VARCHAR(40) NOT NULL,
  url VARCHAR(500) NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  updated_by_user_id CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_social_links_order (display_order),
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
