-- =========================================================
-- VETRA — SCHEMA ADDITIONS for the vendor/order/KYC feature batch
-- (see migrate.js's own comment: this is that anticipated "second
-- migration" — plain ALTER TABLE, no IF NOT EXISTS, run once per
-- environment same as 001_init.sql).
-- =========================================================

-- Device attributes a vendor can optionally fill in on a listing
-- (phones/laptops/tablets — "Black, 256GB" etc.) — free text, not a
-- separate variants table, since the vendor types these in directly
-- rather than picking from a structured option list. Also product
-- search keywords (up to 5, enforced in products.routes.js) so a
-- buyer can find a listing by a term that isn't in the name/description.
ALTER TABLE products
  ADD COLUMN color VARCHAR(120) NULL AFTER category,
  ADD COLUMN storage VARCHAR(120) NULL AFTER color,
  ADD COLUMN keywords JSON NULL COMMENT 'array of up to 5 vendor-supplied search keywords' AFTER description;

-- A VETRA-generated tracking code shown to the customer (POST /api/orders
-- and customer/orders.html), distinct from the order's own id (which
-- every other reference display formats as VTR<id>) and distinct from
-- `tracking_number` (the carrier's own code, vendor-set, may never be
-- filled in for a pickup order). Always present from checkout onward.
ALTER TABLE orders
  ADD COLUMN tracking_code CHAR(11) NULL AFTER id,
  ADD UNIQUE KEY uniq_orders_tracking_code (tracking_code);

-- Per-admin opt-out for the "a vendor submitted KYC" email (the in-app
-- notification + unread count always fires — see vendors.routes.js —
-- only the email is optional). Meaningless on buyer/vendor rows, same
-- "nullable-by-role" precedent as every other admin-only column on
-- this table (admin_role etc.) — defaults true so existing admins keep
-- getting the email until they turn it off themselves.
ALTER TABLE users
  ADD COLUMN kyc_email_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Super Admin-only master switch (admin/settings.html's Platform
-- Controls) — when off, NO admin gets the KYC email regardless of
-- their own kyc_email_alerts_enabled, same override relationship
-- vendor_verification_required already has over an individual vendor's
-- KYC status.
ALTER TABLE platform_settings
  ADD COLUMN kyc_email_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE;
