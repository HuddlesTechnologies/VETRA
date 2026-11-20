-- Payments move from Paystack to Flutterwave (src/utils/flutterwave.js).
-- A clean cut: VETRA no longer talks to Paystack at all. Every payment
-- and payout records which provider it went through, so anything left
-- over from Paystack is never sent to Flutterwave by mistake.

-- Payments: provider-neutral id column, and which provider took the money.
-- Existing rows were all Paystack; new rows default to Flutterwave.
ALTER TABLE payments
  CHANGE COLUMN paystack_transaction_id provider_transaction_id BIGINT NULL,
  ADD COLUMN provider ENUM('paystack', 'flutterwave') NOT NULL DEFAULT 'paystack' AFTER reference;
ALTER TABLE payments
  MODIFY COLUMN provider ENUM('paystack', 'flutterwave') NOT NULL DEFAULT 'flutterwave';

-- Payouts: which provider the transfer was sent through.
ALTER TABLE payouts
  ADD COLUMN provider ENUM('paystack', 'flutterwave') NOT NULL DEFAULT 'paystack' AFTER reference;
-- Never attempted yet: nothing was sent, so Flutterwave sends them.
UPDATE payouts SET provider = 'flutterwave' WHERE attempts = 0 AND status IN ('queued', 'awaiting_account');
-- Attempted through Paystack and not finished: VETRA can no longer ask
-- Paystack how it went, so a Super Admin checks the Paystack dashboard
-- first. Retry then sends it through Flutterwave (utils/payments.js).
UPDATE payouts
  SET status = 'failed',
      failure_reason = 'Sent through Paystack before the move to Flutterwave. Check the Paystack dashboard: if it was paid, cancel this; if not, Retry sends it through Flutterwave.'
  WHERE provider = 'paystack' AND status IN ('processing', 'failed', 'reversed');
ALTER TABLE payouts
  MODIFY COLUMN provider ENUM('paystack', 'flutterwave') NOT NULL DEFAULT 'flutterwave';

-- Refunds: provider-neutral id column.
ALTER TABLE refunds
  DROP INDEX idx_refunds_paystack,
  CHANGE COLUMN paystack_refund_id provider_refund_id BIGINT NULL,
  ADD INDEX idx_refunds_provider (provider_refund_id);
-- Paystack refunds still waiting for Paystack's webhook will never hear
-- back now. They're flagged for a Super Admin to settle by hand.
UPDATE refunds r JOIN payments p ON p.id = r.payment_id
  SET r.status = 'failed',
      r.failure_reason = 'Paid through Paystack, which VETRA no longer uses. Check or make this refund in the Paystack dashboard.'
  WHERE p.provider = 'paystack' AND r.status = 'processing';

-- Paystack transfer recipients: Flutterwave pays bank accounts directly.
ALTER TABLE users DROP COLUMN paystack_recipient_code;
