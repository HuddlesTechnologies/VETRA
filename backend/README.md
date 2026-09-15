# VETRA API

The real backend behind the VETRA frontend — see `../BACKEND_GUIDE.md` for the full plan this implements (data model reasoning, security notes, what's deliberately not built yet). This file is just the practical "how do I run this" reference.

## Stack

Express + `mysql2` (no ORM — plain SQL, kept deliberately simple), JWT auth (`jsonwebtoken` + `bcryptjs`), Anthropic's SDK for the AI shopping assistant. `bcryptjs` (pure JS) is used instead of `bcrypt` specifically because it doesn't need a native compiler toolchain — matters on shared hosting.

## Local setup

1. `npm install`
2. `cp .env.example .env` and fill in real values — a MySQL database (local or already provisioned), a `JWT_SECRET` (generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`), an `ENCRYPTION_KEY` (same command, or any random string — see `src/utils/encryption.js`), Cloudinary credentials if you want file uploads working (free tier, no card — sign up at cloudinary.com, its Dashboard shows the three values), and an `ANTHROPIC_API_KEY` if you're testing the assistant.
3. `npm run migrate` — runs everything in `migrations/` against the database in your `.env`. Safe to re-run (every statement is `CREATE TABLE IF NOT EXISTS`) **on a fresh database** — if you're adding this migration's newest columns to a database that already ran an older version of `001_init.sql`, `CREATE TABLE IF NOT EXISTS` won't retroactively add columns to a table that already exists; run the equivalent `ALTER TABLE ... ADD COLUMN` statements by hand once instead (compare `migrations/001_init.sql` against `DESCRIBE <table>` on your database to see what's missing).
4. `npm start` (or `npm run dev` for auto-restart on file changes). Confirm it's up: `curl http://localhost:4000/api/health` → `{"ok":true}`.

**Already deployed, for reference**: `https://vetra-api-11an.onrender.com` — live on Render's free tier against a free Clever Cloud MySQL database, fully migrated and smoke-tested end to end (signup/signin/password-change/payout-account/report-filing all verified working against it directly, not just locally). See "Deploying to Render" below for how this was set up, and `render.yaml` at the project root for the exact config.

## What's implemented

| Area | File | Covers |
|---|---|---|
| Auth | `src/routes/auth.routes.js` | Buyer/vendor signup+signin, admin signin, JWT issuing, real password change (`PATCH /password`) |
| Products | `src/routes/products.routes.js` | Public browse/search, vendor create/edit/remove |
| Orders | `src/routes/orders.routes.js` | Checkout (signed-in or guest), customer order history, vendor order list + shipment updates |
| Reviews | `src/routes/reviews.routes.js` | Per-vendor review list + submission, gated on a real completed order |
| Reports | `src/routes/reports.routes.js` | Admin moderation queue + status changes (Super Admin/Moderator only), vendor read-only view + evidence submission |
| Vendors | `src/routes/vendors.routes.js` | Public vendor directory + single-vendor lookup, vendor's own KYC submission (`GET`/`POST /me/kyc`), vendor's own payout account (`GET`/`PUT /me/payout-account`, AES-256-GCM encrypted at rest) |
| Site banners | `src/routes/site-banners.routes.js` | Public read, Super-Admin-only add/reorder/remove |
| Uploads | `src/routes/uploads.routes.js` | `POST /` — real file upload (multipart, Cloudinary-backed), returns a URL for any of the above routes to save |
| Admin | `src/routes/admin.routes.js` | Customer/vendor management (Super Admin/Moderator only), stats, role-scoped activity log, admin team + invite/verify (Super Admin only), vendor KYC review (Super Admin/Moderator only) |
| AI assistant | `src/routes/assistant.routes.js` | Chat endpoint grounded in a keyword search over the product catalog |

`PATCH /api/auth/me` (in `auth.routes.js`) is the generic self-profile-update endpoint behind every per-field pencil-edit save site-wide (vendor Store Details, customer Profile card, admin Account Details) — see `BACKEND_GUIDE.md` §5. `POST /api/reports` (in `reports.routes.js`) lets a signed-in buyer file a report against one of their own orders, not just admin/vendor touching the `reports` table.

Every mutating admin/vendor action writes an `activity_log` row server-side (`src/utils/activityLog.js`) — see `BACKEND_GUIDE.md` §6 point 7 for why that's not left to the client.

**Admin role enforcement** (`BACKEND_GUIDE.md` §4 point 6): every admin route requires `role = 'admin'`; on top of that, suspending/reactivating/approving/rejecting a customer or vendor, reviewing KYC, and resolving/dismissing a report additionally require `requireAdminRole("Super Admin", "Moderator")` — a Support admin can view everything and reset a password, but can't make any of those moderation calls. Managing the admin team itself (`/team`, `/invites`) stays `requireAdminRole("Super Admin")` only, unchanged.

## What's been checked

There's no automated test suite yet — what's been manually verified so far is: `node --check` passes on every file in `src/`; the server boots and `GET /api/health` returns `{"ok":true}`; hitting an auth-required route with no token returns `401` instead of crashing; and hitting a DB-dependent route without a real database configured fails with a graceful `500` rather than taking the process down. Beyond that baseline, the full stack has actually been exercised end-to-end against the real live deployment (`https://vetra-api-11an.onrender.com`) and its real Clever Cloud database, not just locally: signup → signin → password change, a vendor creating a product and a buyer checking out and filing a report against that order, and a vendor saving + re-reading a payout account (confirming the encrypt/mask round-trip actually works), all run for real and cleaned up afterward. That's still manual verification, not automated test coverage — a real test suite (even a thin one hitting the routes above with `supertest` or similar) is worth adding before this goes anywhere near production traffic.

## What's deliberately stubbed

A few things are wired up structurally but marked `TODO` in the code rather than fully built, because they depend on a provider that isn't chosen/configured yet:

- **Email delivery** (password resets, admin invite codes) — currently `console.log`'d where a real send would go. Search the codebase for `TODO: email` to find every spot.
- **Guest-checkout toggle enforcement** — `POST /api/orders` always allows a guest today; wiring the actual on/off effect of `admin/settings.html`'s toggle is a small follow-up once that setting has somewhere real to live.
- **48-hour auto-confirm on delivery** (escrow auto-release) — needs a scheduled job (cron), not a request handler; not built yet.
- **Semantic product search** — the assistant currently grounds itself in a plain keyword `LIKE` search (see `src/routes/assistant.routes.js`'s comment for why that's the deliberate starting point). The `products.description_embedding` column already exists in the schema for when this is worth adding.
- **Payments** — checkout (`POST /api/orders`) computes a real total and writes a real order, but nothing actually charges a card — no Paystack/Flutterwave integration yet.
- **Escrow auto-release after 48hrs** — needs a scheduled job (cron), not a request handler; explicitly paused for now (not forgotten) rather than half-built alongside this round of route work.
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

**4. Fill in the environment variables Render couldn't guess** (Render's dashboard → the `vetra-api` service → **Environment**): `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` from step 1; `CORS_ORIGINS` set to wherever the frontend is actually served from while testing (a `file://` origin can't be listed here — see the note below); `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` if you want file uploads working (free tier, no card — cloudinary.com); `ANTHROPIC_API_KEY` if you want the AI assistant endpoint working. `JWT_SECRET`/`ENCRYPTION_KEY` are auto-generated by the blueprint, `DB_SSL`/`DB_PORT`/`JWT_EXPIRES_IN`/`ASSISTANT_MODEL` already have sane defaults from `render.yaml`.

**5. Confirm it's up**: Render gives the service a URL like `https://vetra-api.onrender.com` — `curl https://vetra-api.onrender.com/api/health` should return `{"ok":true}`. The free tier spins the service down after ~15 minutes of no traffic and takes 30-60s to wake back up on the next request — expected on a free tier, not a bug; fine for testing, would need a paid plan to avoid for anything real.

**Pointing the static frontend at it while testing**: nothing in the frontend currently calls this API at all (see `BACKEND_GUIDE.md` §1/§2 — every page still reads mock data). To actually exercise a route from the real site while both are being built, the simplest path is serving the frontend itself from somewhere with a real `http(s)://` origin too (even `npx serve .` locally, or a second free Render **Static Site** for the `VETRA/` root) rather than opening the HTML files directly via `file://` — `fetch()` calls from a `file://` page are blocked by the browser before `CORS_ORIGINS` even comes into play. Add whatever origin you end up serving the frontend from to `CORS_ORIGINS` (comma-separated if more than one).

## Deploying to Namecheap shared hosting (cPanel)

1. **cPanel → Setup Node.js App** → create a new application, point its "Application root" at wherever you upload this `backend/` folder, and its "Application startup file" at `src/server.js`. Pick a Node version (18+ works fine — this doesn't use anything newer).
2. **cPanel → MySQL Databases** → create a database and a user with full privileges on it (the wizard gives you the exact `DB_NAME`/`DB_USER` values, usually prefixed with your cPanel username).
3. In the Node app's cPanel page, add the same variables `.env.example` lists as **environment variables** through cPanel's UI, not a committed `.env` file — `DB_HOST` is almost always `localhost` on shared hosting.
4. Use cPanel's "Run NPM Install" button (or its built-in terminal) to install dependencies inside that environment, then run `npm run migrate` the same way to create the tables.
5. Start/restart the app from the same cPanel page. It's now reachable at whatever subdomain/path you pointed it at in step 1 — set that as the frontend's API base URL.

The frontend itself (plain static files) doesn't go through any of this — it just uploads to the hosting account's document root as always.
