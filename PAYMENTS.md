# VETRA — Payments, payouts and refunds

How money moves through VETRA: buyers pay through Flutterwave, riders and vendors are paid by Flutterwave transfer, and refunds go back to the buyer's card. The code is `backend/src/utils/payments.js` (all of the logic), `backend/src/utils/flutterwave.js` (the Flutterwave calls, and the only place amounts are converted between kobo and naira), `backend/src/routes/payments.routes.js` (checkout, the return-page check, the webhook) and migrations `017_payments.sql` and `028_flutterwave.sql`.

**VETRA used Paystack until November 2026** and no longer talks to it at all. Rows from then carry `provider = 'paystack'`: refunds on those orders are made by hand in the Paystack dashboard (VETRA marks them failed with that note), and a payout that was mid-way through Paystack at the switch waits as failed until a Super Admin checks the Paystack dashboard and either cancels it or retries it through Flutterwave. See §11.

---

## 1. The money rules

| | Rule |
|---|---|
| **What the buyer pays** | Goods + delivery for every store in the cart + a **processing fee**. Flutterwave adds its fee at its own checkout (customers bear the fees, the dashboard default), so VETRA asks for goods + delivery and receives it in full. Flutterwave's local price is 2% (1.4% + 0.6% platform fee) plus 7.5% VAT on the fee; the cart shows that as an estimate (`api-client.js`'s `processingFee()`), and `payments.processing_fee` records what was actually charged. |
| **Rider** | `deliveries.rider_payout`: the zone rate × `rider_payout_percent` (80% by default), fixed when the order is placed. Paid **the moment the buyer's delivery code is entered**, and also for a parcel that's returned to the vendor. Free delivery doesn't reduce it. |
| **Vendor** | Order goods total − commission, plus the delivery fee if the vendor shipped it themselves. Paid **when escrow releases**: the buyer taps "I received it", or the protection window (48 hours by default) passes with no open report. |
| **Commission** | `platform_settings.commission_percent`, set by a Super Admin on `admin/payments.html` (0–50%, 0 by default). Taken from goods only, never delivery. Snapshotted onto each order when it's created (`orders.commission_percent`), so changing it never affects orders already placed. |
| **VETRA keeps** | Commission + (delivery fee − rider payout). The processing fee only covers Flutterwave. |
| **Refunds** | Goods + delivery for the affected order, to the buyer's card. **The processing fee isn't refunded** (Flutterwave keeps its fee on a refund), except when a payment never became an order at all, which is refunded in full. |

Orders placed before payments existed have `orders.payment_id` NULL. No money was collected for them, so they never pay out or refund automatically. Riders on those jobs are paid by hand and recorded with **Mark paid** on the Deliveries page.

---

## 2. Checkout

```
cart.html ── POST /api/payments/checkout ──▶ payments.startCheckout()
                                              • prices every store's share, quotes delivery
                                              • reserves stock (guarded UPDATE per item)
                                              • stores the whole cart in payments.cart_snapshot
                                              • Flutterwave POST /v3/payments
          ◀── { authorizationUrl } ──────────
browser ──▶ Flutterwave checkout (card, transfer, USSD)
Flutterwave ─▶ POST /api/payments/webhook (charge.completed) ┐
browser  ──▶ customer/orders.html?payment=<ref>             │  both call
             └ polls GET /api/payments/<ref> ───────────────┤  finalizePayment(ref)
                                                            ▼
                                     verify with Flutterwave (amount + currency must match)
                                     one transaction: mark payment 'success' (guarded)
                                       + create one order per store, its items and its delivery row
                                     then: vendor and buyer emails, notifications, activity
```

- **No unpaid order ever exists.** Orders are only created inside `finalizePayment`, so none of the existing order and delivery queries need to filter anything out. The claim and the order inserts commit together, so a crash can't leave a payment marked paid with no orders, and the webhook and the return page racing each other create the orders exactly once.
- **Checkout requires a buyer account**, so every payment has an email. Repeating a checkout (double click, retry) with the same key returns the same Flutterwave link instead of starting a second payment.
- **Abandoned checkouts.** A checkout holds its stock for 30 minutes. The sweep then checks Flutterwave once (in case the webhook was missed). If the buyer never paid, it marks the payment `abandoned` and gives the stock back.
- **A payment that arrives too late** (after the checkout expired), **or for the wrong amount**, is never fulfilled. It's refunded in full and the buyer is emailed.
- `POST /api/orders` now answers **410**. It only exists so a cached old cart page fails loudly instead of placing an unpaid order.

---

## 3. Payouts

Every payout is a row in `payouts`, unique per job (`kind` + the order or delivery it's for), so no trigger can ever pay a job twice.

| Status | Meaning |
|---|---|
| `queued` | Waiting: automatic payouts are switched off. |
| `awaiting_account` | The payee hasn't added a bank account yet. Sent the moment they do. |
| `processing` | Transfer started; Flutterwave's `transfer.completed` webhook finishes it, or the sweep looks it up after 30 minutes if the webhook never came. |
| `success` | Money sent. For a rider, `deliveries.rider_paid_at` is set too. |
| `failed` | Flutterwave refused, or the balance was short. Retried by the sweep every 30 minutes, up to 5 attempts. |
| `reversed` | The bank reversed it. Treated like `failed`. |

- **The master switch.** `platform_settings.auto_payouts_enabled`, **off by default**. While off, payouts are recorded but nothing leaves the Flutterwave balance. Turning it on (Payments page) sends everything waiting straight away.
- **No double payments on retry.** Each transfer carries a VETRA reference. Before retrying, the sweep asks Flutterwave about the previous attempt (by its transfer id, or by reference if the reply never arrived): if it went through, it's recorded; if it failed, the retry goes out under a fresh reference; if Flutterwave has no record, the same reference is reused, and Flutterwave refuses a duplicate reference, so it can't be sent twice.
- **Bank accounts.** Vendors add theirs on `vendor/earnings.html`, riders on the Bank tab of the rider app. Both use `utils/payoutAccount.js`: the account name comes from the bank via Flutterwave, never typed; the number is AES-256-GCM encrypted and only ever shown masked. Flutterwave transfers go straight to the bank code and account number, with no saved recipient. An account saved in the Paystack days whose bank code isn't on Flutterwave's list is matched by bank name; if that fails too, the payout waits as `awaiting_account` until the payee saves the account again.

---

## 4. Refunds

| Trigger | Amount |
|---|---|
| Vendor cancels an order (`PATCH /api/orders/:id/shipment`) | Everything not yet refunded |
| Vendor marks an item unavailable | That item; everything if it was the last item |
| Dispatch cancels before pickup | Everything |
| Parcel returned to the vendor | Everything (the rider is still paid) |
| Super Admin manual refund (Payments page) | Any amount up to what's left; a partial refund comes out of the goods, so it also lowers the vendor's payout |
| Payment too late, or wrong amount | The whole payment |

- Refunds are capped atomically: `orders.refunded_amount` can never exceed goods + delivery paid for that order.
- **Refunds are never retried automatically.** Flutterwave's refund call takes no idempotency key, so a refund that timed out may still have gone through. It's recorded as `failed` with that warning, and a Super Admin retries it from the Payments page after checking the Flutterwave dashboard. Refunds go by Flutterwave's transaction id (`payments.provider_transaction_id`). One Flutterwave reports as still pending stays `processing`, and the sweep asks Flutterwave about it every run until it settles.
- A manual refund isn't allowed once the vendor has been paid for that order (escrow released). Recover it from the vendor outside VETRA.

---

## 5. Webhook

`POST https://api.vetrahq.org/api/payments/webhook`, mounted in `app.js` with `express.raw()` **before** `express.json()`, because the `flutterwave-signature` header is an HMAC-SHA256 (base64) of the raw body. It's authenticated with `FLW_WEBHOOK_HASH`, the secret hash set in Flutterwave's Settings → Webhooks: either the `verif-hash` header equals it, or `flutterwave-signature` matches the HMAC keyed with it. Anything else gets 401 and changes nothing. The body is never trusted on its own: every handler looks the charge, transfer or refund up with Flutterwave again before recording it.

| Event | Effect |
|---|---|
| `charge.completed` | `finalizePayment(data.tx_ref)` |
| `transfer.completed` | Updates the payout (`SUCCESSFUL` or `FAILED`) |
| `refund.*` | Updates the refund, if Flutterwave sends one (the sweep polls refunds anyway) |

Every handler is idempotent, and the route always answers 200 once the signature checks out, so Flutterwave's own retries are harmless.

---

## 6. The sweep

`backend/scripts/delivery-cron.js` (cPanel cron, every 10 minutes) runs the delivery sweep, then `runPaymentsCron()`:

1. expire abandoned checkouts and give their stock back;
2. while automatic payouts are on: send `queued` payouts, `awaiting_account` payouts whose payee now has an account, and `failed` payouts due a retry.

Escrow releases happen in the delivery sweep first, so the vendor payouts they create go out in the same run.

---

## 7. Endpoints

| Route | Who | Does |
|---|---|---|
| `POST /api/payments/checkout` | buyer | `{ groups: [{ vendorId, items: [{ productId, quantity }] }], deliveryMethod, deliveryAddress?, deliveryState?, deliveryPhone?, deliveryNotes?, idempotencyKey }` → `{ reference, authorizationUrl }` or `{ reference, alreadyPaid }` |
| `GET /api/payments/:reference` | buyer (own) | Status, tracking codes once paid, `refunded` for a late payment. Finalizes if the webhook hasn't arrived. |
| `POST /api/payments/webhook` | Flutterwave | Signature-checked, see §5 |
| `GET/PUT /api/vendors/me/payout-account`, `/banks`, `/resolve` | vendor | Bank account |
| `GET/PUT /api/delivery/rider/payout-account`, `/banks`, `/resolve` | rider | Bank account |
| `GET /api/vendors/me/earnings` | vendor | Each order's goods, commission, net and payout; totals |
| `GET/PATCH /api/admin/payments/settings` | Super Admin | `commissionPercent`, `autoPayoutsEnabled` |
| `GET /api/admin/payments`, `/payouts?status=`, `/refunds` | Super Admin | Lists (200 rows) |
| `POST /api/admin/payouts/:id/retry`, `/refunds/:id/retry` | Super Admin | Retry |
| `POST /api/admin/orders/:id/refund` | Super Admin | `{ reason, amount? }` (kobo; omit for everything). `:id` may be the tracking code. |
| `GET /api/admin/balance` | Super Admin | Balance card |

---

## 8. Data

- **`payments`**: one per checkout. Reference, buyer, email, goods / delivery / fee / amount (kobo), status (`initialized`, `success`, `failed`, `abandoned`), the cart snapshot (JSON), the idempotency key, `provider` (`flutterwave`, or `paystack` for old rows), the provider's transaction id (`provider_transaction_id`) and channel, `expires_at`.
- **`orders`** gains `payment_id`, `commission_percent`, `commission_amount` (set at escrow release), `refunded_amount`.
- **`payouts`**: kind (`vendor` / `rider`), payee, order or delivery, amount, VETRA reference, `provider`, the Flutterwave transfer id (`transfer_code`), status, attempts, failure reason.
- **`refunds`**: order (NULL for a payment that never became one), payment, amount, reason, status, the provider's refund id (`provider_refund_id`), failure reason.
- **`platform_settings`** gains `commission_percent` and `auto_payouts_enabled`.

---

## 9. Going live (Flutterwave dashboard)

1. Business verified (KYC) and approved for live payments, with **Transfers / Payouts** enabled.
2. **Turn off transfer approval** (if your account has it). Otherwise every automatic transfer waits for someone to approve it in the dashboard.
3. Settings → Webhooks: URL `https://api.vetrahq.org/api/payments/webhook`, a **secret hash** of your choosing, and the same value in `~/vetra-api/.env` as `FLW_WEBHOOK_HASH`. Turn on webhooks for successful charges and transfers.
4. Leave transaction fees with the customer (the default). If they're switched to the merchant, add `processingFee()` back into `startCheckout()`.
5. **Payouts are paid from the Flutterwave NGN balance.** Collected payments have to stay in it (or it has to be topped up) instead of all settling to the bank. A short balance loses nothing: payouts fail with the reason and retry.
6. Run the migrations (`028_flutterwave.sql`). Test end to end with the `FLWSECK_TEST-` key and Flutterwave's test cards, then put the live key in `~/vetra-api/.env` as `FLW_SECRET_KEY`, restart, and turn **Automatic payouts** on.

---

## 10. Tested

Against a real MySQL 8 database with migrations 001–017 applied and Paystack mocked (before the move to Flutterwave):

- a two-store checkout charges the right amount and reserves stock;
- a repeated checkout reuses the payment;
- the webhook and the return page racing create exactly one order per store;
- wrong-amount and late payments are refunded, not fulfilled;
- expired checkouts restore stock;
- a rider is paid on the delivery code, but only once auto-payouts is on, and only once;
- the vendor is paid goods minus commission on escrow release, waiting for a bank account if needed;
- a failed transfer retries under a new reference;
- refunds are capped;
- legacy orders never pay out;
- a wrongly signed webhook is rejected;
- every money endpoint refuses non-Super Admins, buyers only see their own payments, and commission is hidden from buyers.

After the move to Flutterwave (November 2026): `flutterwave.js` was tested against mocked Flutterwave responses (request bodies and paths, naira/kobo conversion, status mapping, duplicate-reference detection, both webhook signature forms) and the app loads. **Not yet tested:** the migration and the full flow against a database, and a Flutterwave test-mode run, which needs the keys and the webhook set (§9).

---

## 11. The move from Paystack

`028_flutterwave.sql` does it in one go:

- `payments` and `payouts` gain `provider`. Every existing row is `paystack`; new rows are `flutterwave`. Payouts that were never attempted become `flutterwave`, so they go out normally.
- Payouts attempted through Paystack and not finished (`processing`, `failed`, `reversed`) become `failed` with a note. The sweep never touches them. A Super Admin checks the Paystack dashboard, then **Cancel**s the payout if it was paid, or **Retry**s it, which sends it through Flutterwave under a fresh reference.
- Refunds still `processing` on Paystack payments become `failed` with a note to settle them in the Paystack dashboard. A new refund on a Paystack-paid order is recorded straight away as `failed` with the same note, and **Retry** refuses it. Once it's made in the Paystack dashboard, leave the row as it is: cancelling it would stop it counting as refunded on the order.
- A checkout opened on Paystack moments before the switch can't be confirmed any more and expires like an unpaid one. Deploy when no checkouts are open, or check Paystack for any payment that arrived in that window.
- Card fingerprints for bans are now built from Flutterwave's card details, so cards banned from the Paystack days don't match new Flutterwave payments.
- `paystack_transaction_id` and `paystack_refund_id` are renamed to `provider_transaction_id` and `provider_refund_id`, and `users.paystack_recipient_code` is dropped.
