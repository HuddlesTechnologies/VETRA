-- Paystack payments, automatic payouts and refunds (src/utils/payments.js).
--
-- Checkout creates a `payments` row holding the cart snapshot and reserves
-- stock; the real orders are only created once Paystack confirms the
-- charge, so `orders` never holds an unpaid order. Orders placed before
-- this migration have payment_id NULL: no money was collected for them,
-- so they never trigger an automatic payout or refund.

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) PRIMARY KEY,
  reference VARCHAR(64) NOT NULL,
  buyer_id CHAR(36) NULL,
  email VARCHAR(190) NOT NULL,
  goods_total INT NOT NULL COMMENT 'kobo',
  delivery_total INT NOT NULL COMMENT 'kobo',
  processing_fee INT NOT NULL COMMENT 'kobo, what the buyer pays toward Paystack''s fee',
  amount INT NOT NULL COMMENT 'kobo, what Paystack charges',
  status ENUM('initialized', 'success', 'failed', 'abandoned') NOT NULL DEFAULT 'initialized',
  cart_snapshot JSON NOT NULL,
  idempotency_key VARCHAR(128) NULL,
  authorization_url VARCHAR(255) NULL,
  paystack_transaction_id BIGINT NULL,
  channel VARCHAR(40) NULL,
  paid_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_payments_reference (reference),
  UNIQUE KEY uniq_payments_idempotency (idempotency_key),
  INDEX idx_payments_status (status, expires_at),
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE orders
  ADD COLUMN payment_id CHAR(36) NULL AFTER idempotency_key,
  ADD COLUMN commission_percent DECIMAL(5, 2) NULL AFTER payment_id,
  ADD COLUMN commission_amount INT NULL COMMENT 'kobo, set when escrow releases' AFTER commission_percent,
  ADD COLUMN refunded_amount INT NOT NULL DEFAULT 0 COMMENT 'kobo' AFTER commission_amount,
  ADD INDEX idx_orders_payment (payment_id),
  ADD CONSTRAINT fk_orders_payment FOREIGN KEY (payment_id) REFERENCES payments(id);

CREATE TABLE IF NOT EXISTS payouts (
  id CHAR(36) PRIMARY KEY,
  kind ENUM('vendor', 'rider') NOT NULL,
  user_id CHAR(36) NOT NULL,
  -- Exactly one of these identifies the job: an order for a vendor
  -- payout, a delivery for a rider payout. source_id repeats it so one
  -- UNIQUE key can stop a job ever being paid twice.
  order_id CHAR(36) NULL,
  delivery_id CHAR(36) NULL,
  source_id CHAR(36) NOT NULL,
  amount INT NOT NULL COMMENT 'kobo',
  reference VARCHAR(64) NOT NULL,
  transfer_code VARCHAR(64) NULL,
  status ENUM('awaiting_account', 'queued', 'processing', 'success', 'failed', 'reversed') NOT NULL DEFAULT 'queued',
  attempts TINYINT NOT NULL DEFAULT 0,
  failure_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  completed_at DATETIME NULL,
  UNIQUE KEY uniq_payouts_source (kind, source_id),
  UNIQUE KEY uniq_payouts_reference (reference),
  INDEX idx_payouts_status (status, attempts),
  INDEX idx_payouts_user (user_id, status),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- order_id is NULL only for a payment that arrived after its checkout had
-- expired (no order was ever created), which is refunded in full.
CREATE TABLE IF NOT EXISTS refunds (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NULL,
  payment_id CHAR(36) NOT NULL,
  amount INT NOT NULL COMMENT 'kobo',
  reason VARCHAR(255) NULL,
  status ENUM('processing', 'processed', 'failed') NOT NULL DEFAULT 'processing',
  paystack_refund_id BIGINT NULL,
  failure_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_refunds_order (order_id),
  INDEX idx_refunds_paystack (paystack_refund_id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (payment_id) REFERENCES payments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Paystack transfer recipient for this user's payout account, created on
-- first payout and cleared whenever the account changes.
ALTER TABLE users
  ADD COLUMN paystack_recipient_code VARCHAR(64) NULL AFTER payout_account_number_enc;

ALTER TABLE platform_settings
  ADD COLUMN commission_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN auto_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE;
