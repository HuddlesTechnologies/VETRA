-- A Super Admin helping another admin who's locked out (admin/settings.html,
-- Admin Team): a one-time code is emailed to the locked-out admin, who
-- reads it out to the Super Admin, who enters it along with a new
-- password for them (POST /api/admin/team/:id/password-reset-code[/verify]).
-- The code proves the person asking really controls that admin's inbox.
-- Only a bcrypt hash of the code is stored, same as admin_invites.

CREATE TABLE IF NOT EXISTS admin_password_reset_codes (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL COMMENT 'the admin whose password is being reset',
  requested_by_user_id CHAR(36) NULL COMMENT 'the Super Admin helping them',
  code_hash VARCHAR(255) NOT NULL,
  attempts TINYINT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_reset_codes_user (user_id, used_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
