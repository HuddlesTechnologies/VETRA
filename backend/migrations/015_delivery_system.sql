-- =========================================================
-- VETRA — DELIVERY SYSTEM
--
-- Adds VETRA's own last-mile delivery layer on top of orders:
--   - a `rider` account type (admin-created, never self-service)
--   - per-state delivery rates, quoted server-side at checkout
--   - one `deliveries` row per delivery-method order, carrying the
--     rider assignment, pickup/drop-off snapshots, attempt counts,
--     the rider's last reported location, and rider earnings
--   - `delivery_events`, the append-only timeline every party sees
--   - the buyer's delivery code (proof of receipt) on `orders`
--
-- How the pieces fit together is written up in DELIVERY_SYSTEM.md at
-- the project root. The state machine itself lives in
-- src/utils/delivery.js.
-- =========================================================

ALTER TABLE users
  MODIFY COLUMN role ENUM('buyer', 'vendor', 'admin', 'rider') NOT NULL,
  -- Rider-only fields, nullable on every other role, same
  -- "nullable-by-role" precedent as the vendor store_* columns.
  -- A rider's operating area is the existing `state` column.
  ADD COLUMN rider_vehicle ENUM('bicycle', 'motorbike', 'car', 'van') NULL,
  ADD COLUMN rider_plate VARCHAR(40) NULL,
  ADD COLUMN rider_on_duty BOOLEAN NOT NULL DEFAULT FALSE;

-- What the buyer pays for delivery, by destination state. The fee
-- charged depends on whether the vendor ships from the same state
-- (intra) or a different one (inter). `active = FALSE` makes a state
-- undeliverable (checkout offers pickup only there).
CREATE TABLE IF NOT EXISTS delivery_rates (
  state VARCHAR(60) PRIMARY KEY,
  intra_state_fee INT NOT NULL COMMENT 'kobo',
  inter_state_fee INT NOT NULL COMMENT 'kobo',
  eta_days_min TINYINT NOT NULL DEFAULT 1,
  eta_days_max TINYINT NOT NULL DEFAULT 3,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Defaults only; a Super Admin edits them from admin/deliveries.html.
-- Lagos, FCT and Rivers cost more intra-state for distance/traffic.
INSERT IGNORE INTO delivery_rates (state, intra_state_fee, inter_state_fee, eta_days_min, eta_days_max) VALUES
  ('Abia', 150000, 400000, 1, 4), ('Adamawa', 150000, 450000, 1, 5), ('Akwa Ibom', 150000, 400000, 1, 4),
  ('Anambra', 150000, 400000, 1, 4), ('Bauchi', 150000, 450000, 1, 5), ('Bayelsa', 150000, 400000, 1, 4),
  ('Benue', 150000, 400000, 1, 4), ('Borno', 150000, 500000, 2, 6), ('Cross River', 150000, 400000, 1, 4),
  ('Delta', 150000, 400000, 1, 4), ('Ebonyi', 150000, 400000, 1, 4), ('Edo', 150000, 400000, 1, 4),
  ('Ekiti', 150000, 350000, 1, 4), ('Enugu', 150000, 400000, 1, 4), ('Gombe', 150000, 450000, 1, 5),
  ('Imo', 150000, 400000, 1, 4), ('Jigawa', 150000, 450000, 1, 5), ('Kaduna', 150000, 400000, 1, 4),
  ('Kano', 150000, 400000, 1, 4), ('Katsina', 150000, 450000, 1, 5), ('Kebbi', 150000, 450000, 1, 5),
  ('Kogi', 150000, 400000, 1, 4), ('Kwara', 150000, 350000, 1, 4), ('Lagos', 200000, 350000, 1, 3),
  ('Nasarawa', 150000, 400000, 1, 4), ('Niger', 150000, 400000, 1, 4), ('Ogun', 150000, 300000, 1, 3),
  ('Ondo', 150000, 350000, 1, 4), ('Osun', 150000, 350000, 1, 4), ('Oyo', 150000, 350000, 1, 3),
  ('Plateau', 150000, 400000, 1, 4), ('Rivers', 200000, 400000, 1, 4), ('Sokoto', 150000, 500000, 2, 6),
  ('Taraba', 150000, 450000, 1, 5), ('Yobe', 150000, 500000, 2, 6), ('Zamfara', 150000, 500000, 2, 6),
  ('FCT (Abuja)', 200000, 400000, 1, 3);

ALTER TABLE platform_settings
  -- Subtotal (kobo) at or above which the buyer pays no delivery fee.
  -- 0 disables free delivery. The rider is still paid in full; VETRA
  -- absorbs the fee.
  ADD COLUMN free_delivery_threshold INT NOT NULL DEFAULT 0,
  -- Share of the zone rate paid out to the rider per completed delivery.
  ADD COLUMN rider_payout_percent TINYINT NOT NULL DEFAULT 80,
  -- When on, a delivery the vendor marks ready goes straight to the
  -- least-busy on-duty rider in the pickup state. When off, it waits
  -- in the admin dispatch queue for a manual assignment.
  ADD COLUMN auto_assign_riders BOOLEAN NOT NULL DEFAULT TRUE,
  -- Escrow auto-release window after drop-off (buyer-protection.html's
  -- "48 hours"). Enforced by scripts/delivery-cron.js.
  ADD COLUMN auto_confirm_hours SMALLINT NOT NULL DEFAULT 48,
  -- Failed drop-off attempts before the parcel is sent back to the vendor.
  ADD COLUMN max_delivery_attempts TINYINT NOT NULL DEFAULT 3;

ALTER TABLE orders
  -- What the buyer pays on top of `total`. Kept separate so `total`
  -- keeps meaning "the vendor's goods" everywhere it is already summed
  -- (vendor earnings, admin stats). 0 for pickup and for legacy orders.
  ADD COLUMN delivery_fee INT NOT NULL DEFAULT 0 COMMENT 'kobo' AFTER total,
  ADD COLUMN delivery_state VARCHAR(60) NULL AFTER delivery_address,
  ADD COLUMN delivery_phone VARCHAR(40) NULL AFTER delivery_state,
  ADD COLUMN delivery_notes VARCHAR(255) NULL AFTER delivery_phone,
  -- 6-digit proof-of-receipt code. Shown only to the buyer, who gives
  -- it to the rider (delivery) or the vendor (pickup) at handover.
  -- Never returned by any vendor- or rider-facing route. NULL on
  -- orders placed before this migration, which keep the old
  -- vendor-driven status flow.
  ADD COLUMN delivery_code CHAR(6) NULL AFTER delivery_notes,
  ADD COLUMN delivery_code_attempts TINYINT NOT NULL DEFAULT 0 AFTER delivery_code,
  -- Set when the buyer taps "I received it", or by the cron job when
  -- the auto-confirm window passes. Either one releases escrow.
  ADD COLUMN buyer_confirmed_at DATETIME NULL AFTER delivered_at,
  ADD INDEX idx_orders_escrow_delivered (escrow_status, status, delivered_at);

CREATE TABLE IF NOT EXISTS deliveries (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  -- 'vetra': VETRA rider delivers (the default for every delivery order).
  -- 'self': the vendor opted to ship with their own courier; the
  -- vendor's "Update shipment" modal drives status as before.
  mode ENUM('vetra', 'self') NOT NULL DEFAULT 'vetra',
  status ENUM(
    'awaiting_vendor',   -- order placed, vendor still packing
    'ready',             -- vendor marked it ready, waiting for a rider
    'assigned',          -- offered to a rider, not yet accepted
    'accepted',          -- rider accepted, heading to the vendor
    'picked_up',         -- rider has the parcel (order -> shipped)
    'out_for_delivery',  -- rider heading to the buyer
    'delivered',         -- buyer's code verified (order -> completed)
    'returning',         -- max attempts hit / refused, going back to vendor
    'returned',          -- vendor confirmed it's back (order -> cancelled)
    'cancelled'          -- cancelled before pickup
  ) NOT NULL DEFAULT 'awaiting_vendor',
  rider_id CHAR(36) NULL,
  -- 4-digit code the vendor reads to the rider at handover, proving the
  -- rider collected from the right store. Shown to the vendor only.
  pickup_code CHAR(4) NOT NULL,
  -- Address snapshots taken at checkout, so editing a profile later
  -- never reroutes a parcel already in motion.
  pickup_address VARCHAR(255),
  pickup_state VARCHAR(60),
  pickup_phone VARCHAR(40),
  dropoff_address VARCHAR(255),
  dropoff_state VARCHAR(60),
  dropoff_phone VARCHAR(40),
  recipient_name VARCHAR(190),
  fee_charged INT NOT NULL DEFAULT 0 COMMENT 'kobo, what the buyer paid (0 under free delivery)',
  rider_payout INT NOT NULL DEFAULT 0 COMMENT 'kobo, what the rider earns on delivery',
  rider_paid_at DATETIME NULL,
  failed_attempts TINYINT NOT NULL DEFAULT 0,
  last_failure_reason VARCHAR(255) NULL,
  proof_photo_url VARCHAR(500) NULL,
  rider_lat DECIMAL(9, 6) NULL,
  rider_lng DECIMAL(9, 6) NULL,
  rider_location_at DATETIME NULL,
  ready_at DATETIME NULL,
  assigned_at DATETIME NULL,
  accepted_at DATETIME NULL,
  picked_up_at DATETIME NULL,
  out_for_delivery_at DATETIME NULL,
  delivered_at DATETIME NULL,
  returned_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (rider_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_deliveries_order (order_id),
  INDEX idx_deliveries_status (status, pickup_state),
  INDEX idx_deliveries_rider (rider_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only timeline. `note` is plain text (escaped at render, like
-- notifications.message); `public_note` is the PII-free version the
-- public tracking page shows.
CREATE TABLE IF NOT EXISTS delivery_events (
  id CHAR(36) PRIMARY KEY,
  delivery_id CHAR(36) NOT NULL,
  event VARCHAR(40) NOT NULL,
  note VARCHAR(500) NULL,
  public_note VARCHAR(255) NULL,
  actor_user_id CHAR(36) NULL,
  actor_role VARCHAR(20) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_delivery_events_delivery (delivery_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE notifications
  MODIFY COLUMN type ENUM('order', 'kyc', 'vendor_status', 'account', 'report', 'low_stock', 'delivery') NOT NULL;

ALTER TABLE activity_log
  MODIFY COLUMN type ENUM('account', 'vendor', 'report', 'order', 'login', 'delivery') NOT NULL;
