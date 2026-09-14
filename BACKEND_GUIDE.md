# VETRA — Backend Implementation Guide

This is a separate document from `DOCUMENTATION.md` (which explains what the site does today). This one is a build plan: what to stand up so every feature currently simulated in the browser — auth, orders, chat, admin moderation, password resets, email verification — actually works against a real server. It's organized so you can build it in phases rather than all at once.

---

## 1. Where things stand today

VETRA is 100% front-end: static HTML/CSS/JS, no server, no database. Three areas fake persistence differently:

- **Public site + customer + vendor apps**: no persistence at all. Reload the page and everything resets. Mock data is hard-coded into the HTML/JS.
- **Admin console** (`admin/`): the one exception. It persists to the browser's `localStorage` via a single data-access module, `admin/assets/data.js` (the global `VetraAdmin` object). Every admin page calls named functions on it (`getCustomers`, `setVendorStatus`, `resetCustomerPassword`, `inviteTeamMember`, etc.) instead of touching storage directly.

That second point is why this guide leans on the admin console as the reference: **`admin/assets/data.js` is already shaped like an API client.** Its public function list is close to a complete backend API surface for admin operations — the real work is standing up a server behind it and swapping `localStorage` for `fetch()`. The customer/vendor apps need the same treatment but from scratch, since they never had a data-access layer to begin with.

---

## 2. Target architecture

A conventional three-tier setup is enough; nothing about VETRA needs anything exotic.

```
Browser (existing HTML/CSS/JS, lightly modified to call a real API)
        │  HTTPS (JSON over REST, or GraphQL if you prefer)
        ▼
API server (Node/Express, Django, Rails, Laravel — pick what your team knows)
        │
        ├── Relational database (Postgres recommended) — users, orders, products, reports, activity log
        ├── Object storage (S3 / Cloudinary / Supabase Storage) — product images, avatars, chat attachments
        ├── Email provider (Postmark / SendGrid / SES) — verification codes, password resets, order receipts
        ├── SMS provider (Termii / Africa's Talking) — optional, for phone-based flows common in Nigeria
        ├── Payment gateway (Paystack or Flutterwave — both are standard for NGN) — real checkout
        └── Realtime layer (WebSockets, or a hosted service like Pusher/Ably) — chat, live order status
```

Session/auth can be either server-side sessions (a `session_id` cookie + a `sessions` table) or JWTs. Given this app has three distinct account types (buyer, vendor, admin) with different permissions, sessions are usually simpler to reason about and revoke; JWTs work fine too if you're already using them elsewhere. Either way, **the token/session must carry the account's role**, because every route below needs to check it server-side — the current prototype only checks role in the browser, which is not a security boundary (see §6).

---

## 3. Data model

These map directly to what the front-end already renders, so field names below mostly match what `admin/assets/data.js` and the customer/vendor pages already expect.

### `users` (one table, a `role` column distinguishes buyer / vendor / admin)
| Field | Notes |
|---|---|
| `id` | UUID |
| `role` | `buyer` \| `vendor` \| `admin` |
| `name`, `email`, `phone`, `address` | `email` unique per role (a buyer and a vendor could share an email today in the mock data — decide if that's still allowed) |
| `password_hash` | bcrypt/argon2 — never store plaintext, and note that today's "temporary password" reset flow needs a real hash written here |
| `status` | `active` \| `suspended` \| `pending` (vendors only, pre-approval) \| `rejected` |
| `signup_method` | `email` \| `google` etc. |
| `last_login_at`, `created_at` | |
| `avatar_url` | pointer into object storage, not a base64 blob (the admin console's current avatar upload stores base64 in `localStorage` — fine for a demo, not for a database row) |

Vendor-only fields (either a second `vendor_profiles` table keyed on `user_id`, or nullable columns on `users` if you'd rather keep one table):
`store_name`, `category`, `description`, `products_count`, `orders_count`, `revenue_total`.

Admin-only fields: `admin_role` (`Super Admin` \| `Moderator` \| `Support`) — keep this distinct from the top-level `role` column (which is just "this is an admin account"); `admin_role` is what the current permission checks (`isSuperAdmin()`, `getVisibleActivity()`) key off.

### `products`
`id`, `vendor_id`, `name`, `category`, `price`, `stock_quantity`, `description`, `images` (array of object-storage URLs), `video_url` (nullable), `status` (`active`/`out_of_stock`/`removed`), timestamps. This backs the vendor "Add Product" modal, `vendor/products.html`, and the customer-facing product grids.

### `orders` and `order_items`
An order belongs to a buyer, has a delivery/pickup choice, a status, and a total; `order_items` line-items reference `products` with quantity and price-at-purchase. This is what `customer/cart.html`'s checkout, `customer/orders.html`'s tracking view, and `vendor/orders.html`'s shipment-update modal all need — right now cart/order contents live only in the DOM.

- `status`: `pending` → `processing` → `shipped` → `out_for_delivery` → `completed` (or `cancelled` from any state before delivery). The customer/vendor UIs already show all six states; the extra granularity (`shipped`, `out_for_delivery`) beyond a simpler pending/processing/completed/cancelled set is what backs the delivery-tracking timeline on `customer/orders.html`.
- `carrier`, `tracking_number`: set by the vendor (currently via `vendor/orders.html`'s Update Shipment modal, in-memory only). Nullable until shipped.
- `status_history`: either a separate `order_status_events` table (`order_id`, `status`, `changed_at`, `changed_by_user_id`) or timestamp columns per status (`shipped_at`, `out_for_delivery_at`, `delivered_at`) — either backs the step-by-step timeline `customer/orders.html` currently renders from hard-coded per-step timestamps.
- `escrow_status` / `escrow_released_at`: matches the hold-until-confirmed mechanics described on `buyer-protection.html` (funds release on buyer confirmation or 48hrs after delivery, whichever comes first) and `vendor-protection.html`.

### `reports`
`id`, `type` (`customer`/`vendor`/`product`), `target_id`, `reporter` (free text or a `reporter_user_id` if reports should always come from a logged-in account), `reason`, `status` (`open`/`resolved`/`dismissed`), `attended_by_user_id`, `attended_at`, `created_at`. Matches `admin/assets/data.js`'s `reports` shape exactly.

### `activity_log`
Append-only: `id`, `type` (`account`/`vendor`/`report`/`order`/`login`), `message` (or better — structured fields you render into a message client-side, rather than pre-baked HTML strings like the mock does), `actor_user_id` (nullable — null for platform/system events), `target_type`, `target_id`, `created_at`. This one table is what powers the admin dashboard's recent-activity feed, the full activity log page, and every "who did this" attribution shown on reports and account detail pages. Insert a row from *every* mutating admin action server-side — don't rely on the client to log its own actions, or a compromised/buggy client can go unaudited.

### `admin_invites`
`id`, `name`, `email`, `role`, `invited_by_user_id`, `verification_code_hash` (hash it, don't store the raw code once you're sending real email), `expires_at`, `status` (`pending`/`verified`/`cancelled`). Backs the invite-and-verify admin onboarding flow.

### `report_evidence`
New table backing `vendor/orders.html`'s "Submit evidence" modal: `id`, `report_id`, `vendor_user_id`, `response_text`, `attachment_urls` (array, object storage), `submitted_at`. A report can have zero or more of these; admin's `reports.html` should surface them when reviewing a report so a vendor's response is actually read before a decision is made — right now the mock version just flips the card to an "awaiting review" state with nothing behind it.

### `reviews`
`id`, `vendor_id`, `buyer_id`, `order_id` (**required, not nullable** — this is what makes "verified purchase" real instead of a UI label), `rating` (1–5), `text`, `created_at`. `customer/store.html`'s review form currently has no way to check "did this buyer complete an order with this vendor" since there's no backend — the real version should reject a review submission server-side unless a `completed` order exists linking that `buyer_id` and `vendor_id`, and should look up `order_id` automatically rather than trusting anything the client sends. Aggregate rating (shown as the "4.7 · 3 reviews" summary) should be computed server-side (or cached on `vendor_profiles` and recomputed on write), not summed client-side over every review on every page load.

### `messages`/`conversations` (chat)
Not fully speced here since the front-end for these (`customer/chat.html`) is UI-only mock data — but a `conversations` table (buyer_id, vendor_id) plus a `messages` table (conversation_id, sender_id, body, attachment_url, created_at) is the standard shape. Real-time delivery needs the WebSocket layer from §2.

---

## 4. Authentication & the three account types

1. **Signup/signin** (`signup.html`, `signin.html`): real password hashing, email verification before first login (or at least before checkout, to cut down on fraud), and a real session/JWT issued on success. Buyer and vendor signup should almost certainly be separate flows hitting the same `users` table with `role` set accordingly.
2. **Admin signin** (`admin/login.html`): currently just an email lookup with no password check at all — this is the single most important gap to close. Real build: admin accounts still live in `users` (role=`admin`), get a real password, and — given how sensitive this surface is — should support 2FA (the console already has a "Two-factor authentication" toggle in Settings that's currently cosmetic).
3. **Session propagation**: once real sessions exist, the front-end's `VetraAdmin.getCurrentAdmin()` simulation (which just reads whichever admin last "signed in" via email lookup) gets replaced by "whoever the session belongs to" — the server already knows this from the auth cookie/token on every request, so the client no longer needs to manage it at all.
4. **Guest checkout**: `admin/settings.html`'s "Allow guest checkout" toggle needs a real effect — when it's on, the checkout endpoint should accept an order without a `buyer_id` (or create a lightweight guest record keyed by email/phone for order tracking), and when it's off, checkout should require a session.

---

## 5. API surface, mapped to existing front-end calls

This is the direct swap-in for `admin/assets/data.js`. Left column is the existing mock function; right column is the real endpoint it should become. Keep the same function *names* in the client-side module and just change their bodies to `fetch()` calls — every page that currently calls `VetraAdmin.getCustomers()` etc. doesn't need to change at all.

| Mock function | Real endpoint |
|---|---|
| `getCustomers()` / `getCustomer(id)` | `GET /api/admin/customers`, `GET /api/admin/customers/:id` |
| `setCustomerStatus(id, status, reason)` | `PATCH /api/admin/customers/:id/status` |
| `resetCustomerPassword(id)` | `POST /api/admin/customers/:id/reset-password` → generates a real token, emails the *customer* a reset link (don't return the password to the admin — see §6) |
| `getVendors()` / `getVendor(id)` | `GET /api/admin/vendors`, `GET /api/admin/vendors/:id` |
| `setVendorStatus(id, status, reason)` | `PATCH /api/admin/vendors/:id/status` (covers approve/reject/suspend/reactivate) |
| `resetVendorPassword(id)` | `POST /api/admin/vendors/:id/reset-password` (same email-link pattern) |
| `getReports()` / `getReport(id)` / `getReportsForTarget()` | `GET /api/admin/reports`, `GET /api/admin/reports/:id`, `GET /api/admin/reports?target_type=&target_id=` |
| `setReportStatus(id, status)` | `PATCH /api/admin/reports/:id/status` (server sets `attended_by` from the session, not from a client-supplied value) |
| `getActivity()` / `getVisibleActivity()` / `getActivityForTarget()` | `GET /api/admin/activity` — **role filtering happens server-side**, keyed off the session's admin role, not a client-side function |
| `getTeam()` / `getTeamMember(id)` | `GET /api/admin/team`, `GET /api/admin/team/:id` |
| `setTeamMemberAvatar(id, dataUrl)` | `POST /api/admin/team/:id/avatar` — multipart upload to object storage, store the URL, not the base64 |
| `removeTeamMember(id)` | `DELETE /api/admin/team/:id` (last-Super-Admin check moves server-side) |
| `inviteTeamMember()` / `resendInviteCode()` / `cancelInvite()` / `verifyTeamInvite()` | `POST /api/admin/invites`, `POST /api/admin/invites/:id/resend`, `DELETE /api/admin/invites/:id`, `POST /api/admin/invites/:id/verify` — this is where the *simulated* "any code works" verification gets replaced with a real check against `verification_code_hash`, sent by real email |
| `getStats()` | `GET /api/admin/stats` — computed server-side from real tables instead of `.filter().length` over an in-memory array |
| `resetDemoData()` | Drop entirely — this only exists because the prototype has no real backend to reset |

For the customer and vendor apps (which have no data-access layer yet), the equivalent buildout is: product CRUD, cart/checkout, order history, and chat endpoints, following the same "one client module per app, named functions the pages already call" pattern the admin console demonstrates.

Two additions from the order-tracking/reviews/reports feature pass:

| Mock behaviour | Real endpoint |
|---|---|
| `vendor/assets/order-tracking.js`'s shipment-update form | `PATCH /api/vendor/orders/:id/shipment` (`status`, `carrier`, `tracking_number`) — should also insert an `order_status_events` row so `customer/orders.html`'s timeline gets a real per-step timestamp instead of the mock's hard-coded ones |
| `vendor/assets/reports.js`'s "Submit evidence" modal | `POST /api/vendor/reports/:id/evidence` — writes a `report_evidence` row; a vendor's read of their own reports is `GET /api/vendor/reports` (server-scoped to `target_id = current vendor`, not a client-side filter of the full admin list) |
| `customer/store.html`'s review form | `POST /api/vendors/:id/reviews` — server validates a completed order exists for that buyer/vendor pair before inserting (see §3's `reviews` table); `GET /api/vendors/:id/reviews` replaces the hard-coded `VENDORS[...].reviews` array |

---

## 6. Security — closing the gaps this prototype leaves open

Everything here is flagged in `DOCUMENTATION.md` §9 too; this is the actionable version.

1. **Server-side role enforcement.** Every `/api/admin/*` route must check the session's role before doing anything, full stop. Today's client-side checks (hiding buttons, filtering activity in JS) are UX, not security — assume any of them can be bypassed by calling the endpoint directly.
2. **Password resets shouldn't hand the new password to an admin.** The current UI shows the generated temp password in a panel for the admin to relay manually. A real system emails a reset *link* (or one-time code) straight to the account holder; an admin triggering a reset should never see the resulting credential.
3. **Real email verification for admin invites**, replacing the "type anything" placeholder — generate a code, hash it, email it, compare hashes, expire it after ~15 minutes.
4. **Rate limiting** on auth endpoints (signin, password reset, invite verification) to block brute-forcing.
5. **Input validation & sanitization** server-side for everything — the mock data trusts whatever's typed into a form; a real backend can't.
6. **Least-privilege for `Support` vs `Moderator` vs `Super Admin`.** Decide the actual permission matrix (the front-end's role-gating today only covers "who can see other admins' activity" and "can't delete the last Super Admin" — suspend/approve/reset-password aren't gated by role at all yet) and enforce it in middleware, not per-route ad hoc checks.
7. **Audit log integrity.** Write `activity_log` rows from the server when a mutation happens, never from a client-supplied "log this" call — otherwise a client can fake or omit entries.

---

## 7. Suggested build order

1. **Auth foundation** — `users` table, real password hashing, sessions, the three signin flows (buyer/vendor/admin). Nothing else works without this.
2. **Admin console backend** — it's the best-specified surface (see §5's table), and gives you a working moderation tool before the storefront is fully live.
3. **Product + order + cart** — unblocks the actual buyer/vendor commerce loop.
4. **Reports + activity log wired end-to-end** — now that real actions exist, real audit trails make sense.
5. **Email/SMS integrations** — verification codes, password reset links, order receipts.
6. **Payments** — Paystack/Flutterwave integration for real checkout (replacing the simulated "Order placed!" flow in both `customer/cart.html` and the homepage's "Buy now" modal).
7. **Chat** — WebSocket-backed messaging, last since it's the most architecturally different piece (real-time vs. request/response).
8. **File uploads** — product images, avatars, chat attachments to object storage; can actually be pulled earlier if product photos are a launch blocker.

---

## 8. What NOT to over-build

- Don't build a permissions system more granular than the three roles the UI already has (Super Admin / Moderator / Support) unless there's a concrete need — the front-end doesn't have UI for anything finer-grained.
- Don't build real-time infrastructure for the admin console — nothing there needs to push updates to an open tab; a page refresh (as today) is fine.
- Don't build multi-currency or multi-region support — the whole site is NGN/Nigeria-specific (phone formats, delivery copy, Paystack/Flutterwave as the natural payment choice).
