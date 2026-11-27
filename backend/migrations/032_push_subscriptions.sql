-- Phone and desktop push notifications (src/utils/push.js). One row per
-- browser a user turned notifications on in. The same browser can hold a
-- row for more than one account (a buyer who also sells), so the key is
-- the endpoint and the user together. The endpoint URL is long and set by
-- the browser vendor, so it's stored as TEXT and matched by its SHA-256.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  endpoint TEXT NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_endpoint_user (endpoint_hash, user_id),
  INDEX idx_push_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
