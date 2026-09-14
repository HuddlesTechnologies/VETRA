# VETRA — Backend Implementation Guide

This is a separate document from `DOCUMENTATION.md` (which explains what the site does today). This one is a build plan: what to stand up so every feature currently simulated in the browser — auth, orders, chat, admin moderation, password resets, email verification — actually works against a real server. It's organized so you can build it in phases rather than all at once.

**A real backend now exists** in `backend/` at the project root, implementing everything through §7's step 5 below (auth, admin console, products/orders/cart, reports, reviews, the AI assistant). See `backend/README.md` for how to run it and what's still a marked `TODO` inside the code. The rest of this document is still the reference for *why* it's built the way it is and what comes next — read it alongside the code, not instead of it.

---

## 1. Where things stand today

The frontend is 100% static: HTML/CSS/JS, no build step. Before `backend/` existed, three areas faked persistence differently — this is now historical context for *why* the schema and API look the way they do, not the current state:

- **Public site + customer + vendor apps**: no persistence at all. Reload the page and everything resets. Mock data is hard-coded into the HTML/JS. (The frontend hasn't been rewired to call the new API yet — see the note at the end of §5.)
- **Admin console** (`admin/`): the one exception. It persisted to the browser's `localStorage` via a single data-access module, `admin/assets/data.js` (the global `VetraAdmin` object). Every admin page calls named functions on it (`getCustomers`, `setVendorStatus`, `resetCustomerPassword`, `inviteTeamMember`, etc.) instead of touching storage directly.

That second point is why this guide leaned on the admin console as the reference: **`admin/assets/data.js` was already shaped like an API client.** Its function names are exactly what `backend/src/routes/admin.routes.js` now implements for real — see §5's mapping table.

---

## 2. Target architecture

**Chosen deployment target: Namecheap shared hosting (cPanel), for everything — frontend, backend, and database.** This was picked because it's hosting already owned, at $0 marginal cost, rather than adding a separate Render bill. It's a fine target for an MVP, but it's a *specific* environment with real constraints, and those shape several decisions below:

```
Browser (existing HTML/CSS/JS — unchanged, static files served straight off the hosting account)
        │  HTTPS (JSON over REST)
        ▼
Node.js app, run via cPanel's "Setup Node.js App" (Passenger) — same account, same domain
        │
        ├── MySQL/MariaDB (included free with cPanel) — users, orders, products, reports, activity log
        ├── Local disk storage (cPanel file storage) — product images, avatars, chat attachments;
        │     move to an external object store (Cloudflare R2's free tier is a reasonable upgrade
        │     path) once storage or bandwidth starts to matter
        ├── Email provider (Postmark / SendGrid / SES) — verification codes, password resets, order receipts
        ├── SMS provider (Termii / Africa's Talking) — optional, for phone-based flows common in Nigeria
        └── Payment gateway (Paystack or Flutterwave) — real checkout, webhook-based (works fine here)
```

What this environment **doesn't** give you, and what that means:
- **No WebSockets.** Passenger (cPanel's Node runner) doesn't reliably hold persistent connections, so real-time chat (`customer/chat.html`) has to wait — poll for new messages on an interval instead of pushing them, or defer chat's backend entirely until this moves off shared hosting.
- **No Postgres, no `pgvector`.** MySQL/MariaDB only. This matters for the AI shopping assistant's product search (see §3's `reviews`/embeddings note) — instead of a vector-database similarity search, compute cosine similarity over stored embeddings in application code. That's genuinely fine at this catalog size (thousands, even tens of thousands of products is cheap to loop over in Node) and needs zero extra infrastructure.
- **Shared CPU/RAM**, no root access, limited background job scheduling (cron jobs are supported via cPanel but constrained) — fine for request/response work, not for heavy background processing.

Session/auth: use JWTs sent in an `Authorization` header rather than server-side session cookies. This isn't just a style choice here — it sidesteps needing a `sessions` table and matches how the frontend and backend, even though they're on the same account/domain now, might not stay that way if parts of this move to another host later. **The token must carry the account's role**, because every route below needs to check it server-side — the current prototype only checks role in the browser, which is not a security boundary (see §6).

---

## 3. Data model

These map directly to what the front-end already renders, so field names below mostly match what `admin/assets/data.js` and the customer/vendor pages already expect. Written with MySQL/MariaDB in mind (the shared-hosting target from §2) — the two adjustments from a Postgres version of this same model: no native array type, so anything described as "array of X" below (`images`, `attachment_urls`) is a `JSON` column instead; and no native `UUID` type, so `id` is a `CHAR(36)` storing a UUID string (or `BINARY(16)` if you want it indexed more compactly — either works, `CHAR(36)` is simpler to reason about while building).

### `users` (one table, a `role` column distinguishes buyer / vendor / admin)
| Field | Notes |
|---|---|
| `id` | UUID, stored as `CHAR(36)` |
| `role` | `buyer` \| `vendor` \| `admin` |
| `name`, `email`, `phone`, `address` | `email` unique per role (a buyer and a vendor could share an email today in the mock data — decide if that's still allowed) |
| `password_hash` | bcrypt/argon2 — never store plaintext, and note that today's "temporary password" reset flow needs a real hash written here |
| `status` | `active` \| `suspended` \| `pending` (vendors only, pre-approval) \| `rejected` |
| `signup_method` | `email` \| `google` etc. |
| `last_login_at`, `created_at` | |
| `avatar_url` | pointer into object storage, not a base64 blob (the admin console's current avatar upload stores base64 in `localStorage` — fine for a demo, not for a database row) |

Vendor-only fields (either a second `vendor_profiles` table keyed on `user_id`, or nullable columns on `users` if you'd rather keep one table):
`store_name`, `category`, `description`, `products_count`, `orders_count`, `revenue_total`.

Payout account (backs `vendor/earnings.html`'s Payout Account section, `vendor/assets/payout.js`): `payout_bank_name`, `payout_account_number`, `payout_account_name`. **Never store the raw account number in plaintext if you can avoid it** — encrypt it at rest (or store only a tokenized reference from whatever payout processor you integrate, e.g. Paystack's transfer-recipient API) and never return the full number in any API response once it's saved; the demo's masked-display convention (`•••• 6789`) is the UI contract a real backend needs to actually enforce server-side, not just hide client-side.

Admin-only fields: `admin_role` (`Super Admin` \| `Moderator` \| `Support`) — keep this distinct from the top-level `role` column (which is just "this is an admin account"); `admin_role` is what the current permission checks (`isSuperAdmin()`, `getVisibleActivity()`) key off.

### `products`
`id`, `vendor_id`, `name`, `category`, `price`, `stock_quantity`, `description`, `images` (`JSON` array of object-storage/local-disk URLs), `video_url` (nullable), `status` (`active`/`out_of_stock`/`removed`), timestamps. This backs the vendor "Add Product" modal, `vendor/products.html`, and the customer-facing product grids.

- `description_embedding`: `JSON` column storing the embedding vector (an array of ~1,500 floats) generated once from the product's name+description, used for the AI shopping assistant's search — see §2's note on computing similarity in application code instead of `pgvector`. Regenerate it whenever `name` or `description` changes; leave it `NULL` until then so the search step can just skip un-embedded rows.

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

Everything marked **✅ built** below exists right now in `backend/src/routes/` and was smoke-tested (server boot, route mounting, auth rejection, and graceful DB-error handling — see `backend/README.md`). **⏳ planned** means it's in the schema/plan but not implemented yet, usually because it depends on a provider that isn't configured (email) or infrastructure not worth building before there's real usage (a scheduled job for escrow auto-release).

### Admin — the direct swap-in for `admin/assets/data.js`

Left column is the existing mock function; right column is what it becomes. The client-side module still needs to be rewritten to call these with `fetch()` instead of touching `localStorage` — the backend side of this mapping is done, the frontend side isn't (see the note at the end of this section).

| Mock function | Real endpoint | Status |
|---|---|---|
| `getCustomers()` / `getCustomer(id)` | `GET /api/admin/customers`, `GET /api/admin/customers/:id` | ✅ built |
| `setCustomerStatus(id, status, reason)` | `PATCH /api/admin/customers/:id/status` | ✅ built |
| `resetCustomerPassword(id)` | `POST /api/admin/customers/:id/reset-password` | ✅ built, email TODO — generates a real token but logs it instead of emailing it until an email provider is wired up (§6 point 2 still applies: don't return the credential to the admin once email exists) |
| `getVendors()` / `getVendor(id)` | `GET /api/admin/vendors`, `GET /api/admin/vendors/:id` | ✅ built |
| `setVendorStatus(id, status, reason)` | `PATCH /api/admin/vendors/:id/status` (covers approve/reject/suspend/reactivate) | ✅ built |
| `resetVendorPassword(id)` | `POST /api/admin/vendors/:id/reset-password` | ✅ built, email TODO |
| `getReports()` | `GET /api/admin/reports` (optional `?status=`) | ✅ built |
| `setReportStatus(id, status)` | `PATCH /api/admin/reports/:id/status` — server sets `attended_by` from the authenticated admin, never from the request body | ✅ built |
| `getActivity()` / `getVisibleActivity()` | `GET /api/admin/activity` (Super Admin: optional `?adminId=` filter) — **role filtering happens server-side** now, not in a client function | ✅ built |
| `getTeam()` | `GET /api/admin/team` | ✅ built |
| `setTeamMemberAvatar(id, dataUrl)` | `POST /api/admin/team/:id/avatar` — multipart upload to object storage | ⏳ planned — needs the file-upload/object-storage piece from §7 step 8 |
| `removeTeamMember(id)` | `DELETE /api/admin/team/:id` — last-Super-Admin check enforced server-side | ✅ built |
| `inviteTeamMember()` / `verifyTeamInvite()` | `POST /api/admin/invites`, `POST /api/admin/invites/:id/verify` — the *simulated* "any code works" verification is gone: a real 6-digit code is hashed, stored, expires in 15 minutes, and compared with `bcrypt.compare` on verify | ✅ built, email TODO (code is logged, not emailed) |
| `resendInviteCode()` / `cancelInvite()` | `POST /api/admin/invites/:id/resend`, `DELETE /api/admin/invites/:id` | ⏳ planned |
| `getStats()` | `GET /api/admin/stats` — computed with real `COUNT`/`SUM` queries | ✅ built |
| `resetDemoData()` | Dropped entirely — this only existed because the prototype had no real backend to reset | done (N/A) |

### Auth, products, orders, reviews, reports, AI assistant

The customer/vendor apps never had a data-access layer to swap out — these are new.

| What it's for | Real endpoint | Status |
|---|---|---|
| Buyer/vendor signup | `POST /api/auth/signup` (`role`, `name`, `email`, `password`, + `storeName`/`storeCategory` for vendors) | ✅ built |
| Buyer/vendor signin | `POST /api/auth/signin` | ✅ built |
| Admin signin | `POST /api/auth/admin-signin` | ✅ built |
| Browse/search products | `GET /api/products` (`?vendor=`, `?category=`, `?q=`), `GET /api/products/:id` | ✅ built |
| Vendor product CRUD | `POST /api/products`, `PATCH /api/products/:id`, `DELETE /api/products/:id` (soft delete — sets `status='removed'`) | ✅ built |
| Checkout | `POST /api/orders` — works signed-in or as a guest (see §4 point 4 on wiring the guest-checkout toggle's actual effect) | ✅ built |
| Customer order history/tracking | `GET /api/orders/mine` | ✅ built |
| Vendor order list | `GET /api/orders/vendor` (optional `?status=`) | ✅ built |
| Vendor shipment update | `PATCH /api/orders/:id/shipment` (`status`, `carrier`, `trackingNumber`) — stamps the matching `*_at` timestamp column and releases escrow on `completed` | ✅ built |
| Escrow auto-release after 48hrs with no buyer action | A scheduled job, not a request handler | ⏳ planned — see §7 step 9's note |
| Vendor review list + submission | `GET /api/vendors/:vendorId/reviews`, `POST /api/vendors/:vendorId/reviews` — the completed-order check is real (§3's `reviews` table), not a UI hint | ✅ built |
| Admin report queue + resolve/dismiss | `GET /api/reports`, `PATCH /api/reports/:id/status` | ✅ built |
| Vendor's own reports + evidence | `GET /api/reports/mine`, `POST /api/reports/:id/evidence` | ✅ built |
| Buyer files a report against an order | `POST /api/reports` (`orderId`, `reason`) — server resolves `type`/`targetId` from the order's vendor rather than trusting them from the client | ⏳ planned — the frontend demo (`customer/assets/report-issue.js`) currently reaches into `admin/assets/data.js`'s `addReport()` directly since there's no API yet; this is the endpoint that replaces that call |
| Vendor payout account | `PUT /api/vendor/payout-account` (`bankName`, `accountNumber`, `accountName`), `GET /api/vendor/payout-account` (returns the account masked, never the full number) | ⏳ planned — matches `vendor/assets/payout.js`'s demo form |
| AI shopping assistant | `POST /api/assistant/chat` (`message`, optional `history`) — grounded in a keyword search over `products`, see `backend/src/routes/assistant.routes.js`'s comment for why that's the deliberate v1 approach over embedding-based search | ✅ built |
| Chat (buyer↔vendor messaging) | Not built — needs the polling-based approach from §2 (no WebSockets on shared hosting) | ⏳ planned |

**The frontend still calls none of this.** Every HTML/JS file in `customer/`, `vendor/`, and `admin/` still runs on hard-coded mock data / `localStorage`, exactly as `DOCUMENTATION.md` describes. Pointing the frontend at this API — replacing `admin/assets/data.js`'s `localStorage` calls with `fetch()`, adding real signin/signup submission, wiring the AI assistant into a page — is the next phase, not part of what's built so far.

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

Steps 1–5 are done — see `backend/`. What's left is provisioning (step 0, can't be done from outside a cPanel account), wiring the *frontend* to call any of this instead of its mock data, and steps 6–9 below.

0. ⏳ **cPanel Node.js app + MySQL database, provisioned.** Create the Node app via cPanel's "Setup Node.js App," point it at a subdomain or path, create the MySQL database and user through cPanel's MySQL Database Wizard, and confirm `/api/health` is reachable over HTTPS. `backend/README.md`'s "Deploying to Namecheap shared hosting" section is the concrete walkthrough for this step — it's infrastructure inside your hosting account, so it has to happen there, not in this repo.
1. ✅ **Auth foundation** — `users` table, real password hashing, JWT issuing, the three signin flows (buyer/vendor/admin). `backend/src/routes/auth.routes.js`.
2. ✅ **Admin console backend** — the best-specified surface (§5's table). `backend/src/routes/admin.routes.js`.
3. ✅ **Product + order + cart** — `backend/src/routes/products.routes.js`, `orders.routes.js`.
4. ✅ **Reports + activity log wired end-to-end** — `backend/src/routes/reports.routes.js`, `src/utils/activityLog.js`.
5. ✅ **AI shopping assistant + product search** — `backend/src/routes/assistant.routes.js`, using keyword-search grounding rather than embeddings for this first pass (see §5's note on why).
6. ⏳ **Email/SMS integrations** — verification codes, password reset links, order receipts. Every place this is missing is marked `TODO: email` in the code (`grep -rn "TODO: email" backend/src`).
7. ⏳ **Payments** — Paystack/Flutterwave integration for real checkout (replacing the simulated "Order placed!" flow in both `customer/cart.html` and the homepage's "Buy now" modal).
8. ⏳ **File uploads** — product images, avatars, review photos — to cPanel's file storage initially, with a clear seam to swap in an external object store later (see §2).
9. ⏳ **Chat** — last, and the one piece this hosting target defers rather than just delays: needs polling (not WebSockets) as noted in §2, or a move off shared hosting first if real-time chat becomes a priority sooner than expected.

Not in the original nine steps, worth calling out separately: **rewiring the frontend itself** to call this API instead of its mock data (`admin/assets/data.js`'s `localStorage` calls → `fetch()`, real form submissions on `signin.html`/`signup.html`, an actual chat UI wired to `POST /api/assistant/chat`). None of the backend work above touches a single frontend file — that's a distinct pass, best done feature-by-feature rather than all at once, since each swap is independently testable.

---

## 8. What NOT to over-build

- Don't build a permissions system more granular than the three roles the UI already has (Super Admin / Moderator / Support) unless there's a concrete need — the front-end doesn't have UI for anything finer-grained.
- Don't build real-time infrastructure for the admin console — nothing there needs to push updates to an open tab; a page refresh (as today) is fine.
- Don't build multi-currency or multi-region support — the whole site is NGN/Nigeria-specific (phone formats, delivery copy, Paystack/Flutterwave as the natural payment choice).
- Don't stand up a dedicated vector database (Pinecone, etc.) for the AI product search — application-level cosine similarity over MySQL-stored embeddings (§2, §3) handles this fine at marketplace-catalog scale, and a managed vector DB is real infrastructure to pay for and operate that this project doesn't need yet.
- Don't try to force WebSockets onto shared hosting — polling on an interval is a perfectly normal way to fake "real-time" chat for an MVP, and fighting Passenger to hold persistent connections open is time better spent elsewhere.
