-- Store the vendor's legal identity name parts separately so CheckID.ng
-- responses can be compared field-by-field. The existing users.name remains
-- the display-name compatibility field for older pages and accounts.
ALTER TABLE users
  ADD COLUMN first_name VARCHAR(100) NULL AFTER name,
  ADD COLUMN middle_name VARCHAR(100) NULL AFTER first_name,
  ADD COLUMN last_name VARCHAR(100) NULL AFTER middle_name;
