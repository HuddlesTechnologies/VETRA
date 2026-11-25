-- Admin roles and permissions become data instead of a fixed list of
-- three names. See backend/src/utils/adminPermissions.js.
--
--   admin_roles                 one row per role, with the permission keys it carries
--   admin_permission_overrides  extra permissions granted to (or taken from) one admin
--
-- users.admin_role and admin_invites.admin_role stop being an ENUM so
-- new roles can be created from admin/settings.html. The three original
-- roles are seeded with exactly what each could do before, so nobody's
-- access changes on deploy.

ALTER TABLE users MODIFY admin_role VARCHAR(60) NULL;
ALTER TABLE admin_invites MODIFY admin_role VARCHAR(60) NOT NULL;

CREATE TABLE IF NOT EXISTS admin_roles (
  name VARCHAR(60) PRIMARY KEY,
  description VARCHAR(255) NULL,
  -- JSON array of permission keys, stored as text so it works on every
  -- MySQL/MariaDB version cPanel hosts run.
  permissions TEXT NOT NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_permission_overrides (
  user_id CHAR(36) NOT NULL,
  permission VARCHAR(60) NOT NULL,
  effect ENUM('grant', 'deny') NOT NULL,
  updated_by_user_id CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO admin_roles (name, description, permissions, is_system) VALUES
  ('Super Admin', 'Full access, including managing other admins and roles.', '[]', 1),
  ('Moderator', 'Reviews reports, approves and suspends accounts, dispatches deliveries.',
   '["customers.status","customers.contact","vendors.status","vendors.kyc","vendors.contact","vendors.payout_account","products.remove","users.ban","devices.unban","reports.resolve","deliveries.dispatch","riders.manage"]', 0),
  ('Support', 'Reads accounts, orders and messages; answers customers.', '[]', 0);
