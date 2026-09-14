-- =========================================================
-- VETRA — INITIAL SCHEMA (MySQL / MariaDB)
-- Matches the data model in ../../BACKEND_GUIDE.md §3. This file
-- is the source of truth for the schema — the guide describes it
-- in prose, this is what actually gets run.
--
-- Run with: npm run migrate   (see scripts/migrate.js)
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  role ENUM('buyer', 'vendor', 'admin') NOT NULL,
  name VARCHAR(190) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40),
  address VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('active', 'suspended', 'pending', 'rejected') NOT NULL DEFAULT 'active',
  signup_method VARCHAR(40) NOT NULL DEFAULT 'email',
  avatar_url VARCHAR(500),
  -- Vendor-only fields — nullable on buyer/admin rows rather than a
  -- separate vendor_profiles table, since this stage of the app only
  -- has a handful of them (see BACKEND_GUIDE.md §3's note on this choice).
  store_name VARCHAR(190),
  store_category VARCHAR(120),
  store_description TEXT,
  -- Admin-only field. Deliberately distinct from `role`, which only says
  -- "this is an admin account" — admin_role is what permission checks key off.
  admin_role ENUM('Super Admin', 'Moderator', 'Support'),
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_email_role (email, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) PRIMARY KEY,
  vendor_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  category VARCHAR(120) NOT NULL,
  price INT NOT NULL COMMENT 'kobo, to avoid float rounding on currency',
  stock_quantity INT NOT NULL DEFAULT 0,
  description TEXT,
  images JSON COMMENT 'array of image URLs',
  video_url VARCHAR(500),
  status ENUM('active', 'out_of_stock', 'removed') NOT NULL DEFAULT 'active',
  -- Embedding vector (array of floats) for the AI shopping assistant's
  -- product search — see BACKEND_GUIDE.md §2's note on doing similarity
  -- search in application code instead of a vector-database extension.
  description_embedding JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES users(id),
  INDEX idx_products_vendor (vendor_id),
  INDEX idx_products_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) PRIMARY KEY,
  buyer_id CHAR(36) NULL COMMENT 'NULL for a guest checkout',
  guest_name VARCHAR(190),
  guest_email VARCHAR(190),
  guest_phone VARCHAR(40),
  vendor_id CHAR(36) NOT NULL,
  delivery_method ENUM('delivery', 'pickup') NOT NULL DEFAULT 'delivery',
  delivery_address VARCHAR(255),
  status ENUM('pending', 'processing', 'shipped', 'out_for_delivery', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  carrier VARCHAR(120),
  tracking_number VARCHAR(120),
  total INT NOT NULL COMMENT 'kobo',
  escrow_status ENUM('held', 'released', 'refunded') NOT NULL DEFAULT 'held',
  escrow_released_at DATETIME,
  shipped_at DATETIME,
  out_for_delivery_at DATETIME,
  delivered_at DATETIME,
  cancelled_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (buyer_id) REFERENCES users(id),
  FOREIGN KEY (vendor_id) REFERENCES users(id),
  INDEX idx_orders_buyer (buyer_id),
  INDEX idx_orders_vendor (vendor_id),
  INDEX idx_orders_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  price_at_purchase INT NOT NULL COMMENT 'kobo — snapshot, not a live join to products.price',
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_order_items_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reviews (
  id CHAR(36) PRIMARY KEY,
  vendor_id CHAR(36) NOT NULL,
  buyer_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL COMMENT 'required — this is what makes "verified purchase" real',
  rating TINYINT NOT NULL,
  review_text TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES users(id),
  FOREIGN KEY (buyer_id) REFERENCES users(id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  UNIQUE KEY uniq_review_per_order (order_id),
  INDEX idx_reviews_vendor (vendor_id),
  CONSTRAINT chk_rating_range CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reports (
  id CHAR(36) PRIMARY KEY,
  type ENUM('customer', 'vendor', 'product') NOT NULL,
  target_id CHAR(36) NOT NULL,
  reporter VARCHAR(190),
  reporter_user_id CHAR(36),
  reason TEXT NOT NULL,
  status ENUM('open', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  attended_by_user_id CHAR(36),
  attended_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_user_id) REFERENCES users(id),
  FOREIGN KEY (attended_by_user_id) REFERENCES users(id),
  INDEX idx_reports_target (type, target_id),
  INDEX idx_reports_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS report_evidence (
  id CHAR(36) PRIMARY KEY,
  report_id CHAR(36) NOT NULL,
  vendor_user_id CHAR(36) NOT NULL,
  response_text TEXT NOT NULL,
  attachment_urls JSON,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activity_log (
  id CHAR(36) PRIMARY KEY,
  type ENUM('account', 'vendor', 'report', 'order', 'login') NOT NULL,
  message TEXT NOT NULL,
  actor_user_id CHAR(36) COMMENT 'NULL for platform/system events',
  target_type VARCHAR(40),
  target_id CHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id),
  INDEX idx_activity_target (target_type, target_id),
  INDEX idx_activity_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_invites (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  email VARCHAR(190) NOT NULL,
  admin_role ENUM('Super Admin', 'Moderator', 'Support') NOT NULL,
  invited_by_user_id CHAR(36) NOT NULL,
  verification_code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  status ENUM('pending', 'verified', 'cancelled') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
