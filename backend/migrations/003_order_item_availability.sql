-- =========================================================
-- VETRA — per-item availability on an order (partial-fulfillment)
--
-- Lets a vendor flag one line item on an order as unavailable (e.g.
-- discovered out of stock while packing) without cancelling the whole
-- order — see backend/src/routes/orders.routes.js's PATCH
-- /:id/items/:itemId/unavailable. The order's own `total` is
-- recomputed to exclude that item's line total the moment this happens.
--
-- Note on "refund": this app has no real payment gateway integrated
-- yet (see BACKEND_GUIDE.md §7 / backend/README.md's stubbed-things
-- list) — checkout never actually charges a card, so there is no real
-- money to reverse today. Marking an item unavailable simply means the
-- buyer is never charged for it (orders.total drops before anything
-- resembling a "payment" concept exists). escrow_status='refunded' is
-- only ever set here for the edge case where *every* item on an order
-- becomes unavailable (the whole order cancels) — it's a status label
-- for that future integration to react to, not a real transaction
-- reversal.
-- =========================================================

ALTER TABLE order_items
  ADD COLUMN status ENUM('fulfilled', 'unavailable') NOT NULL DEFAULT 'fulfilled',
  ADD COLUMN unavailable_reason VARCHAR(255) NULL;
