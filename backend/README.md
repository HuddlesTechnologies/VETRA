# VETRA API

The real backend behind the VETRA frontend — see `../BACKEND_GUIDE.md` for the full plan this implements (data model reasoning, security notes, what's deliberately not built yet). This file is just the practical "how do I run this" reference.

## Stack

Express + `mysql2` (no ORM — plain SQL, kept deliberately simple), JWT auth (`jsonwebtoken` + `bcryptjs`), Anthropic's SDK for the AI shopping assistant. `bcryptjs` (pure JS) is used instead of `bcrypt` specifically because it doesn't need a native compiler toolchain — matters on shared hosting.

## Local setup

1. `npm install`
2. `cp .env.example .env` and fill in real values — a MySQL database (local or already provisioned), a `JWT_SECRET` (generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`), an `ENCRYPTION_KEY` (same command, or any random string — see `src/utils/encryption.js`), Cloudinary credentials if you want file uploads working (free tier, no card — sign up at cloudinary.com, its Dashboard shows the three values), a `GOOGLE_CLIENT_ID` if you want "Continue with Google" working (console.cloud.google.com — see the `.env.example` comment on exactly which credential type), and an `ANTHROPIC_API_KEY` if you're testing the assistant.
3. `npm run migrate` — runs everything in `migrations/` against the database in your `.env`. Safe to re-run (every statement is `CREATE TABLE IF NOT EXISTS`) **on a fresh database** — if you're adding this migration's newest columns to a database that already ran an older version of `001_init.sql`, `CREATE TABLE IF NOT EXISTS` won't retroactively add columns to a table that already exists; run the equivalent `ALTER TABLE ... ADD COLUMN` statements by hand once instead (compare `migrations/001_init.sql` against `DESCRIBE <table>` on your database to see what's missing).
4. `npm start` (or `npm run dev` for auto-restart on file changes). Confirm it's up: `curl http://localhost:4000/api/health` → `{"ok":true}`.

**Already deployed, for reference**: `https://vetra-api-11an.onrender.com` — live on Render's free tier against a free Clever Cloud MySQL database, fully migrated and smoke-tested end to end (signup/signin/password-change/payout-account/report-filing all verified working against it directly, not just locally). See "Deploying to Render" below for how this was set up, and `render.yaml` at the project root for the exact config.

## What's implemented

| Area | File | Covers |
|---|---|---|
| Auth | `src/routes/auth.routes.js` | Buyer/vendor signup+signin, admin signin, JWT issuing, real password change (`PATCH /password`), real Google Sign-In (`POST /google`, finds-or-creates by email+role, flags `needsProfileCompletion` since Google never supplies a phone/address) |
| Products | `src/routes/products.routes.js` | Public browse/search (gated on vendor approval — a pending vendor's own `?vendor=` listing still works), vendor create/edit/remove, real sales-count aggregate for the "Hot" badge |
| Orders | `src/routes/orders.routes.js` | Checkout (signed-in or guest) — single-vendor per order by design, so a multi-vendor cart calls this once per vendor (see `customer/assets/cart.js`) — idempotent via a client-generated `idempotencyKey` (replays the same order instead of duplicating on a stalled-network retry), customer order history, vendor order list + shipment updates. Both list routes include a per-order item summary (name/qty/price/image) via a `JSON_ARRAYAGG` subquery |
| Reviews | `src/routes/reviews.routes.js` | Per-vendor review list + submission, gated on a real completed order |
| Reports | `src/routes/reports.routes.js` | Admin moderation queue + status changes (Super Admin/Moderator only) with target-scoping filters (`?type&targetId`) for a detail page's own history, vendor read-only view + evidence submission |
| Vendors | `src/routes/vendors.routes.js` | Public vendor directory + single-vendor lookup (both include a real `kyc_verified` flag — separate from being approved to sell at all), vendor's own KYC submission (`GET`/`POST /me/kyc`), vendor's own payout account (`GET`/`PUT /me/payout-account`, AES-256-GCM encrypted at rest) |
| Site banners | `src/routes/site-banners.routes.js` | Public read, Super-Admin-only add/reorder/remove |
| Uploads | `src/routes/uploads.routes.js` | `POST /` — real file upload (multipart, Cloudinary-backed, images/PDF/video), returns a URL for any of the above routes to save |
| Admin | `src/routes/admin.routes.js` | Customer/vendor management (Super Admin/Moderator only) with real order/revenue aggregates and per-account order history/activity/KYC for the detail pages, stats, role-scoped activity log, admin team + invite/verify/cancel (Super Admin only), vendor KYC review (Super Admin/Moderator only) |
| AI assistant | `src/routes/assistant.routes.js` | Chat endpoint grounded in a keyword search over the product catalog |

`PATCH /api/auth/me` (in `auth.routes.js`) is the generic self-profile-update endpoint behind every per-field pencil-edit save site-wide (vendor Store Details, customer Profile card, admin Account Details, and the post-Google-Sign-In "complete your profile" step). `POST /api/reports` (in `reports.routes.js`) lets a signed-in buyer file a report against one of their own orders, not just admin/vendor touching the `reports` table.

Every mutating admin/vendor action writes an `activity_log` row server-side (`src/utils/activityLog.js`) — see `BACKEND_GUIDE.md` §6 point 7 for why that's not left to the client.

**Admin role enforcement** (`BACKEND_GUIDE.md` §4 point 6): every admin route requires `role = 'admin'`; on top of that, suspending/reactivating/approving/rejecting a customer or vendor, reviewing KYC, and resolving/dismissing a report additionally require `requireAdminRole("Super Admin", "Moderator")` — a Support admin can view everything and reset a password, but can't make any of those moderation calls. Managing the admin team itself (`/team`, `/invites`) stays `requireAdminRole("Super Admin")` only, unchanged.

## What's been checked

There's no automated test suite yet — what's been manually verified so far is: `node --check` passes on every file in `src/`; the server boots and `GET /api/health` returns `{"ok":true}`; hitting an auth-required route with no token returns `401` instead of crashing; and hitting a DB-dependent route without a real database configured fails with a graceful `500` rather than taking the process down. Beyond that baseline, the full stack has been exercised end-to-end against the real live deployment (`https://vetra-api-11an.onrender.com`), its real Clever Cloud database, and the real Vercel-hosted frontend — not just locally, and not just via curl, driven through the actual browser UI: the full customer shopping flow (browse the real catalog, add to cart, checkout — including verifying the checkout idempotency key actually prevents a duplicate order on a repeated request), the vendor side (listing a product with a real Cloudinary upload, seeing a real order, updating its shipment status), reports (a buyer filing one, the vendor seeing and responding to it), and the entire admin console (dashboard, customers, vendors — including a real approve action on a throwaway vendor without touching the real pending one already in the database — reports, activity, settings' admin-team invite/verify/cancel flow, and both detail pages). All test accounts/orders/reports were cleaned out of the live database afterward; Google Sign-In's actual popup flow was confirmed working by the project owner directly, since completing a real Google consent screen isn't something that can be automated. That's still manual verification, not automated test coverage — a real test suite (even a thin one hitting the routes above with `supertest` or similar) is worth adding before this goes anywhere near production traffic.

**Database health** (checked directly against the live Clever Cloud instance): `EXPLAIN` on every route touched this round showed indexed lookups, not scans, with one exception — `GET /api/vendors`' `role='vendor' AND status='active'` filter had no indexed path, since `users`' only other index is a `(email, role)` uniqueness constraint. Added `idx_users_role_status (role, status)` (in `migrations/001_init.sql` and applied directly to the live database) since that exact filter runs on nearly every customer-facing page load. The connection pool (`connectionLimit: 10` in `src/db.js`) is well under the database's own `max_connections` (2000) and this app's own actual usage (3 connections at any time observed) — the high `Threads_connected`/`Max_used_connections` numbers you'd see querying `SHOW STATUS` on this database belong to other tenants sharing Clever Cloud's free multi-tenant server, not this app.

## What's deliberately stubbed

A few things are wired up structurally but marked `TODO` in the code rather than fully built, because they depend on a provider that isn't chosen/configured yet:

- **Cloudinary credentials are confirmed working** (real upload + public-URL fetch tested directly against the account) but need to be set on the live Render deploy separately from this local `.env` — `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` are real secrets, so they're `sync: false` in `render.yaml` (never committed) and have to be pasted into Render → the `vetra-api` service → Environment by hand. Until that's done there, `POST /api/uploads` still 500s in production even though the code and credentials are both confirmed correct.
- **Email delivery** (password resets, admin invite codes) — currently `console.log`'d where a real send would go. Search the codebase for `TODO: email` to find every spot. The admin console's invite flow explicitly tells the inviting admin to check Render's logs for the code as a stand-in for this.
- **Guest-checkout toggle enforcement** — `POST /api/orders` always allows a guest today; wiring the actual on/off effect of `admin/settings.html`'s toggle is a small follow-up once that setting has somewhere real to live.
- **48-hour auto-confirm on delivery** (escrow auto-release) — needs a scheduled job (cron), not a request handler; explicitly paused for now, not forgotten, rather than half-built alongside a round of route work.
- **Semantic product search** — the assistant currently grounds itself in a plain keyword `LIKE` search (see `src/routes/assistant.routes.js`'s comment for why that's the deliberate starting point). The `products.description_embedding` column already exists in the schema for when this is worth adding.
- **Payments** — checkout (`POST /api/orders`) computes a real total and writes a real order, but nothing actually charges a card — no Paystack/Flutterwave integration yet.
- **Chat** — not built. The frontend feature itself is currently hidden site-wide (no nav entry anywhere), so there's nothing to wire a backend to right now.

## Deploying to Render (free tier, for testing while you build)

This is the fastest way to get the API on a real URL the frontend (or Postman/curl) can hit from outside your machine, without paying for anything or waiting for shared hosting to be ready. Render's own free tier doesn't include a database, so you'll pair it with a separate free MySQL host.

**1. Get a free MySQL database first** (pick one):
   - **Clever Cloud** ([clever-cloud.com](https://www.clever-cloud.com)) — its "Dev" MySQL plan is free indefinitely (small storage cap, fine for testing). Create an account, add a MySQL add-on, and its dashboard gives you a host/port/database/user/password — copy all five.
   - **Aiven** ([aiven.io](https://aiven.io)) — free trial credit rather than permanently free; fine to start with, just don't wire up production traffic to it long-term.
   - **db4free.net** — zero signup friction (just a web form, no card), explicitly meant for exactly this "testing while building" use case, but small (200MB) and rate-limited — best for early smoke-testing, not for anything you need to keep reliably reachable.

   Whichever you pick, run the migration against it once you have credentials: set `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` (and `DB_SSL=true` — all three of the above require TLS) in a local `.env`, then `npm run migrate` from your machine. You only need to do this once; Render doesn't need to run it.

**2. Push this repo to GitHub** if it isn't already (Render deploys from a GitHub/GitLab connection, not a manual upload) — `backend/` can stay a subfolder of the same repo as the frontend, no separate repo needed.

**3. Deploy the blueprint**: on [render.com](https://render.com), **New +** → **Blueprint**, connect this repo. Render reads `render.yaml` at the project root automatically (`rootDir: backend`, so it only builds/runs the API, not the static frontend files) and creates a free web service named `vetra-api`.

**4. Fill in the environment variables Render couldn't guess** (Render's dashboard → the `vetra-api` service → **Environment**): `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` from step 1; `CORS_ORIGINS` set to wherever the frontend is actually served from while testing (a `file://` origin can't be listed here — see the note below); `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` if you want file uploads working (free tier, no card — cloudinary.com); `ANTHROPIC_API_KEY` if you want the AI assistant endpoint working. `GOOGLE_CLIENT_ID` (for "Continue with Google") is set directly in `render.yaml` with a real value rather than `sync: false`, since it's not secret — it's embedded in the frontend's own JS too. `JWT_SECRET`/`ENCRYPTION_KEY` are auto-generated by the blueprint, `DB_SSL`/`DB_PORT`/`JWT_EXPIRES_IN`/`ASSISTANT_MODEL` already have sane defaults from `render.yaml`.

**5. Confirm it's up**: Render gives the service a URL like `https://vetra-api.onrender.com` — `curl https://vetra-api.onrender.com/api/health` should return `{"ok":true}`. The free tier spins the service down after ~15 minutes of no traffic and takes 30-60s to wake back up on the next request — expected on a free tier, not a bug; fine for testing, would need a paid plan to avoid for anything real.

**Pointing the static frontend at it**: `customer/` and most of `vendor/` already call this API for real (see `api-client.js` at the project root and `BACKEND_GUIDE.md` §5's "Frontend wiring status") — `VETRA_API_BASE` in `api-client.js` is hardcoded to this deployment's URL. The frontend itself is deployed on Vercel (`https://vetra-vercel.vercel.app` as of this writing) rather than opened via `file://`, since `fetch()` calls from a `file://` page are blocked by the browser before `CORS_ORIGINS` even comes into play. Whatever origin serves the frontend needs to be in `CORS_ORIGINS` (comma-separated if more than one).

## Deploying to Namecheap shared hosting (cPanel)

1. **cPanel → Setup Node.js App** → create a new application, point its "Application root" at wherever you upload this `backend/` folder, and its "Application startup file" at `src/server.js`. Pick a Node version (18+ works fine — this doesn't use anything newer).
2. **cPanel → MySQL Databases** → create a database and a user with full privileges on it (the wizard gives you the exact `DB_NAME`/`DB_USER` values, usually prefixed with your cPanel username).
3. In the Node app's cPanel page, add the same variables `.env.example` lists as **environment variables** through cPanel's UI, not a committed `.env` file — `DB_HOST` is almost always `localhost` on shared hosting.
4. Use cPanel's "Run NPM Install" button (or its built-in terminal) to install dependencies inside that environment, then run `npm run migrate` the same way to create the tables.
5. Start/restart the app from the same cPanel page. It's now reachable at whatever subdomain/path you pointed it at in step 1 — set that as the frontend's API base URL.

The frontend itself (plain static files) doesn't go through any of this — it just uploads to the hosting account's document root as always.
