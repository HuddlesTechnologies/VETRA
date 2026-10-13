-- Device bans (admin/customer-detail.html, vendor-detail.html). Each
-- browser holds a random device ID (api-client.js) sent with every API
-- request. user_devices records which accounts used which device;
-- banned_devices is checked on every non-admin request
-- (middleware/deviceBan.js) and stays until an admin lifts it.

CREATE TABLE IF NOT EXISTS user_devices (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  user_agent VARCHAR(255) NULL,
  last_ip VARCHAR(45) NULL,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_device (user_id, device_id),
  INDEX idx_user_devices_device (device_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS banned_devices (
  device_id VARCHAR(64) PRIMARY KEY,
  user_id CHAR(36) NULL,
  reason VARCHAR(255) NULL,
  banned_by_user_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (banned_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
