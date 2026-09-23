# VETRA API

The backend behind the VETRA frontend. This file covers running it locally and how it is deployed. For the API reference and the data model, see `../BACKEND_GUIDE.md`. For operating the live deployment (service accounts, direct database access, creating a Super Admin without the console), see `../ADMIN_GUIDE.md`.

**Live**: `https://vetra-api-11an.onrender.com` (Render free tier, Clever Cloud MySQL). Health check: `curl https://vetra-api-11an.onrender.com/api/health` returns `{"ok":true}`.

## Stack

Express 4 with `mysql2` and no ORM, just plain SQL. JWT auth via `jsonwebtoken` and `bcryptjs`. `bcryptjs` is the pure-JS implementation rather than native `bcrypt` because it needs no compiler toolchain.

Full dependency list, all direct:

| Package | Used for |
|---|---|
| `express`, `cors` | HTTP server and the CORS allow-list |
| `mysql2` | The connection pool, `mysql2/promise` |
| `jsonwebtoken`, `bcryptjs` | Tokens and password hashing |
| `express-rate-limit` | The nine per-route limiters in `src/middleware/rateLimit.js` |
| `multer` | Multipart parsing for `POST /api/uploads`, memory storage only |
| `cloudinary` | File storage |
| `resend` | Transactional email |
| `@anthropic-ai/sdk` | The AI shopping assistant |
| `dotenv` | Local `.env` loading |

Paystack, CheckID.ng, and Google's token endpoints are called with the global `fetch`, no SDK, since each needs only one or two endpoints.

**Node 18 or newer is required.** The code uses global `fetch` and `FormData` (both Node 18+), and `npm run dev` uses `node --watch`. Node 20 or 22 is a safe choice. There is no `engines` field in `package.json` pinning this.

## Local setup

1. **`npm install`**

2. **`cp .env.example .env`** and fill it in. The minimum to boot and do anything useful is a reachable MySQL database plus `JWT_SECRET`. Everything else degrades gracefully, see the table below.

   Generate the two secrets with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY
   ```
   `ENCRYPTION_KEY` does not have to be hex. It is hashed down to a 32-byte AES key in `src/utils/encryption.js`, so any non-empty string works.

3. **`npm run migrate`** runs every `.sql` file in `migrations/` in filename order against the database in your `.env`, skipping anything already recorded in the `schema_migrations` table it creates on first run. Safe to re-run at any time.

4. **`npm start`**, or `npm run dev` for restart-on-change. Confirm with `curl http://localhost:4000/api/health`.

## Environment variables

| Variable | Required? | Notes |
|---|---|---|
| `PORT` | no | Defaults to 4000. Render sets this itself. |
| `CORS_ORIGINS` | yes in production | Comma-separated origins allowed to call the API. Unset falls back to `https://vetra-vercel.vercel.app` rather than `*`. A `file://` page cannot be listed here, see the note at the end. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | yes | `DB_PORT` defaults to 3306. |
| `DB_SSL` | depends | `true` for essentially every managed/free MySQL host, including Clever Cloud. Leave false for a local MySQL. |
| `DB_CONNECTION_LIMIT` | no | Pool size, defaults to 20. Must stay at or below your database plan's own per-account connection cap. The live Render deployment pins this to 5, see below. |
| `DB_QUEUE_LIMIT` | no | Defaults to 50. mysql2's own default is 0 (unbounded), which turns a traffic burst into hung requests instead of a fast, visible error. |
| `JWT_SECRET` | yes | Changing it signs everyone out immediately. |
| `JWT_EXPIRES_IN` | no | Defaults to `7d`. The absolute maximum token lifetime. |
| `SESSION_IDLE_TIMEOUT_MINUTES` | no | Defaults to 30. Server-side inactivity window enforced by `src/middleware/auth.js` against `users.last_activity_at`. |
| `LOW_STOCK_THRESHOLD` | no | Defaults to 5. Stock at or below this notifies and emails the vendor. |
| `ENCRYPTION_KEY` | yes if payouts or KYC are used | AES-256-GCM key material for vendor bank account numbers and KYC identity numbers. |
| `GOOGLE_CLIENT_ID` | for Google Sign-In | Not secret; it is embedded in the frontend's JS too. Only the Client ID is ever needed, never the Client Secret. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | for uploads | Free tier, no card. The Cloudinary dashboard home page shows all three. |
| `RESEND_API_KEY` | for real email | Without it, every email is logged to the console instead and the triggering action still completes. |
| `EMAIL_FROM` | for real email to real people | Must be on a domain verified at resend.com/domains. Unset falls back to Resend's sandbox sender, which only delivers to the Resend account's own verified address. |
| `FRONTEND_URL` | no | Base URL used to build links inside emails, for example the password-reset link. Defaults in code to `https://vetra-vercel.vercel.app`. Not set in `render.yaml`, so the default is what production actually uses. |
| `ANTHROPIC_API_KEY` | for the assistant | |
| `ASSISTANT_MODEL` | no | Defaults to `claude-haiku-4-5-20251001`. |
| `PAYSTACK_SECRET_KEY` | for payout accounts | The test key (`sk_test_...`) works identically for both calls this app makes, since neither moves money. |
| `CHECKID_BASE_URL` | no | Defaults to `https://sandbox.checkid.ng`. |
| `CHECKID_API_KEY` | for KYC verification | Server-side only. It must never appear in frontend JavaScript. |

Which features an unset variable actually breaks is in `BACKEND_GUIDE.md` §7. The short version: only the database and `JWT_SECRET` are genuinely load-bearing for boot; everything else fails as one specific feature rather than taking the app down.

## What is implemented

| Area | File | Covers |
|---|---|---|
| Auth | `src/routes/auth.routes.js` | Buyer/vendor signup and signin, separate admin signin, Google Sign-In (server-side token verification against Google's tokeninfo and userinfo endpoints), email-based 2FA, `GET`/`PATCH /me`, password change, password-reset redemption, self-service deactivate and delete |
| Products | `src/routes/products.routes.js` | Public browse and search (FULLTEXT over name/description plus `JSON_SEARCH` over vendor keywords), vendor CRUD, derived `active`/`out_of_stock` status, live sales-count aggregate, restricted-keyword auto-flagging, low-stock alerts |
| Orders | `src/routes/orders.routes.js` | Checkout (signed in or guest, one vendor per order, idempotent, transactional with guarded stock decrements), buyer history, vendor list, shipment updates, per-item "unavailable" partial fulfilment, itemised emails at every stage |
| Vendors | `src/routes/vendors.routes.js` | Public directory and storefront lookup, KYC document submission and CheckID.ng verification, payout account with Paystack NUBAN resolution and AES-256-GCM encryption at rest |
| Reviews | `src/routes/reviews.routes.js` | Per-vendor list and submission, gated on a real completed order, one per order |
| Reports | `src/routes/reports.routes.js` | Admin moderation queue, buyer-filed reports against an order, vendor read-only view and evidence submission |
| Admin | `src/routes/admin.routes.js` | Customer and vendor management with real aggregates, per-account order/product/activity/IP history, stats, role-scoped activity log, admin team and invites, KYC review, payout-account audit view, OTP-gated email changes, platform settings |
| Site banners | `src/routes/site-banners.routes.js` | Public read, Super Admin add/reorder/remove |
| Uploads | `src/routes/uploads.routes.js` | One multipart route to Cloudinary, 20MB cap, KYC documents uploaded as `type: authenticated` with signed URLs |
| Notifications | `src/routes/notifications.routes.js` | Per-user notification list, unread count, mark read, mark all read |
| Assistant | `src/routes/assistant.routes.js` | Anthropic chat grounded in a keyword search over the real catalogue. Built and reachable, but no frontend page calls it yet |

Shared pieces: `src/utils/activityLog.js` and `src/utils/notify.js` write audit and notification rows server-side from the route that performed the mutation, both best-effort so a logging failure never breaks the action that succeeded. `src/utils/escapeHtml.js` escapes user-controlled text at write time for the four columns the frontend renders with `innerHTML`. `src/middleware/auth.js` re-reads the account row on every authenticated request, which is what makes suspensions, role changes, and `session_version` revocation take effect immediately.

## What has been checked

There is no automated test suite. What exists is manual verification, and it is worth being precise about the difference.

Baseline: `node --check` passes on every file in `src/`; the server boots and `/api/health` returns `{"ok":true}`; an auth-required route with no token returns 401 rather than crashing; a DB-dependent route with no database configured fails with a graceful 500 rather than taking the process down.

Beyond that, the full stack has been driven end to end through the real browser UI against the live Render deployment, the live Clever Cloud database, and the live Vercel frontend: the customer shopping flow (browse, cart, checkout, including confirming the idempotency key prevents a duplicate order on a repeated request), the vendor side (listing a product with a real Cloudinary upload, receiving an order, updating shipment status), reports (a buyer filing one, the vendor responding), and the whole admin console including the invite/verify/cancel flow and both detail pages. Test accounts and orders were cleaned out of the live database afterwards. Google Sign-In's popup was confirmed by the project owner directly, since a real Google consent screen cannot be automated.

That is still manual verification. A thin `supertest` suite over the routes above is worth adding before this sees production traffic.

**Database health.** `EXPLAIN` on the routes touched during the last review showed indexed lookups rather than scans. The one exception found was `GET /api/vendors`' `role = 'vendor' AND status = 'active'` filter, which had no indexed path, since the only other index on `users` is the `(email, role)` uniqueness constraint. `idx_users_role_status (role, status)` was added for it, because that exact filter runs on nearly every customer-facing page load.

**Connection limits.** `src/db.js` defaults `connectionLimit` to 20, a number chosen back when Namecheap shared hosting was the target (its `maxEntryProc` cap). That default is not what production uses: the Clever Cloud database user's own `max_user_connections` is 5, so `render.yaml` pins `DB_CONNECTION_LIMIT` to `"5"` and an env value always beats the code default. Observed real usage against Clever Cloud has peaked at 3 simultaneous connections. High `Threads_connected` numbers on that server belong to other tenants of the shared instance, not to this app. If a `render.yaml` change does not take effect (Blueprint sync is not always automatic for env var edits), set the value directly in the Render dashboard instead. One stale comment to ignore: `render.yaml` describes the `db.js` default as 500, and it is 20.

**A timezone bug worth not reintroducing.** The pool used to set `dateStrings: true`, which made every `DATETIME` column come back as a naive `"YYYY-MM-DD HH:mm:ss"` string with no timezone marker. A browser in WAT (UTC+1) parses that as its own local time, silently shifting every timestamp exactly one hour into the past, confirmed by a clean 3,600,000ms offset in a controlled test. It is removed. mysql2's default returns real `Date` objects, which serialise as `...Z`-suffixed UTC and parse correctly in any timezone.

## Deploying to Render

The live deployment is a Render Blueprint driven by **`render.yaml` at the project root**, not inside `backend/`. It sets `rootDir: backend`, so Render builds and runs only the API and ignores the static frontend files.

- `buildCommand`: `npm install`
- `startCommand`: `npm run migrate && npm start`. **Migrations run automatically on every deploy**, so a new migration file goes live with the push that adds it. That also means a migration that fails takes the deploy down, which is the intended behaviour: better a failed deploy than a running app against a half-migrated schema.
- `healthCheckPath`: `/api/health`

**Variables `render.yaml` sets directly**: `JWT_EXPIRES_IN`, `SESSION_IDLE_TIMEOUT_MINUTES`, `LOW_STOCK_THRESHOLD`, `DB_SSL`, `DB_PORT`, `DB_CONNECTION_LIMIT`, `ASSISTANT_MODEL`, `CHECKID_BASE_URL`, and `GOOGLE_CLIENT_ID` (a real value, not a placeholder, since a Client ID is not secret and is embedded in the frontend's JS anyway).

**Variables it generates**: `JWT_SECRET` and `ENCRYPTION_KEY`, both `generateValue: true`.

**Variables marked `sync: false`**, which must be filled in by hand in the Render dashboard under the `vetra-api` service's Environment tab: `CORS_ORIGINS`, `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `ANTHROPIC_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `PAYSTACK_SECRET_KEY`, `CHECKID_API_KEY`.

`FRONTEND_URL` is in neither list. It falls back in code to `https://vetra-vercel.vercel.app`, which is currently correct. Set it explicitly if the frontend ever moves, or email links will point at the wrong place.

Saving an environment variable redeploys the service, same as a code push.

### Setting this up from scratch

1. **Get a MySQL database.** Render's free tier does not include one. Clever Cloud's "Dev" MySQL plan is free indefinitely with a small storage cap and is what this project uses; its dashboard gives you host, port, database, user, and password. Aiven works too, on trial credit rather than a permanently free plan. All of them require `DB_SSL=true`.
2. **Push to GitHub.** Render deploys from a Git connection, not an upload. `backend/` can stay a subfolder of the same repo as the frontend.
3. **New + → Blueprint** on render.com, connect the repo. Render finds `render.yaml` at the root automatically and creates the `vetra-api` free web service.
4. **Fill in the `sync: false` variables** listed above.
5. **Confirm**: `curl https://<service>.onrender.com/api/health`.

The free tier spins the service down after roughly 15 minutes without traffic and takes 30 to 60 seconds to wake on the next request. That is how the free plan works, not a bug, and avoiding it means a paid plan.

### Pointing the frontend at it

`VETRA_API_BASE` in `api-client.js` at the project root is the single place the API URL lives, and it is hardcoded to the Render deployment. Whatever origin serves the frontend must appear in `CORS_ORIGINS`. Note that a page opened over `file://` cannot work regardless of CORS configuration: the browser blocks `fetch()` from a `file://` origin before CORS is even consulted, which is why the frontend is served from Vercel even during testing.

Frontend deploys are not automatic. Pushing to GitHub updates the backend (Render watches the repo) but not the static site; Vercel here is driven from the CLI with `vercel --prod --yes`. See `ADMIN_GUIDE.md` §1.

## Adding a migration

Write a new numbered file in `migrations/` following the existing pattern: plain additive SQL (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN`, `MODIFY COLUMN` to widen an enum), no down-migration. Do not edit an already-applied file; `scripts/migrate.js` records filenames, not contents, so an edit to an applied file is silently skipped.

Then either run `npm run migrate` locally against the target database, or just deploy, since Render runs it on start.

One caveat applies to a database where earlier migrations were applied by some other means before `schema_migrations` existed: back-fill those filenames first, or the runner will try to replay them and fail on the first duplicate column.

```sql
INSERT IGNORE INTO schema_migrations (filename) VALUES
  ('002_feature_updates.sql'), ('003_order_item_availability.sql');
```

## A note on other hosting targets

`.env.example` and `src/db.js` still carry comments written for Namecheap shared hosting (cPanel), which was the original target before this moved to Render. None of it is in use. If this ever does move to cPanel, the shape is: create the app through cPanel's "Setup Node.js App" pointed at `src/server.js`, create the database through the MySQL Database Wizard, set the same environment variables through cPanel's UI rather than a committed `.env` (with `DB_HOST` almost always `localhost`), install dependencies and run `npm run migrate` from cPanel's terminal, and restart. The one thing to re-check before trusting the old comments is the plan's actual `maxEntryProc` value on cPanel's Resource Usage page, rather than the 20 written in this repo.
