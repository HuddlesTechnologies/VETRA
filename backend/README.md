# VETRA API

The backend behind the VETRA frontend. This file covers running it locally and how it is deployed. For the API reference and the data model, see `../BACKEND_GUIDE.md`. For operating the live deployment (service accounts, direct database access, creating a Super Admin without the console), see `../ADMIN_GUIDE.md`.

**Live**: `https://vetra-api-11an.onrender.com` (Render free tier, Clever Cloud MySQL). Health check: `curl https://vetra-api-11an.onrender.com/api/health` returns `{"ok":true}`.

**Moving to cPanel**: everything needed is in this repo (`.cpanel.yml`, `scripts/copy-data.js`, `scripts/delivery-cron.js`, `scripts/package-cpanel.sh`). The step-by-step is in [Moving to cPanel](#moving-to-cpanel) below. Until that cutover is done, Render remains the live host.

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
| `nodemailer` | Transactional email over SMTP (the cPanel mailbox) |
| `@anthropic-ai/sdk` | The AI shopping assistant |
| `dotenv` | Local `.env` loading |

Paystack, CheckID.ng, and Google's token endpoints are called with the global `fetch`, no SDK, since each needs only one or two endpoints.

**Node 20 or newer is required** (`engines` in `package.json`). `nodemailer` 10 needs 20, and the code uses global `fetch` and `FormData`.

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
| `CORS_ORIGINS` | yes in production | Comma-separated origins allowed to call the API. Unset falls back to `https://vetrahq.org` and `https://www.vetrahq.org` rather than `*`. A `file://` page cannot be listed here, see the note at the end. |
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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | for real email | The cPanel mailbox emails are sent from: `mail.vetrahq.org`, `465`, `true`, `noreply@vetrahq.org`, and that mailbox's password. Without `SMTP_HOST`, every email is logged to the console instead and the triggering action still completes. The server logs `[email] SMTP ready` or `[email] SMTP check failed` at startup. |
| `EMAIL_FROM` | no | Defaults to `VETRA <SMTP_USER>`. Must be the `SMTP_USER` mailbox or an alias of it, or the mail server and receiving spam filters reject it. |
| `FRONTEND_URL` | no | Base URL used to build links inside emails, for example the password-reset link. Defaults in code to `https://vetrahq.org`. |
| `ANTHROPIC_API_KEY` | for the assistant | |
| `ASSISTANT_MODEL` | no | Defaults to `claude-haiku-4-5-20251001`. |
| `PAYSTACK_SECRET_KEY` | for payout accounts | The test key (`sk_test_...`) works identically for both calls this app makes, since neither moves money. |
| `CHECKID_BASE_URL` | no | Defaults to `https://sandbox.checkid.ng`. |
| `CHECKID_API_KEY` | for KYC verification | Server-side only. It must never appear in frontend JavaScript. |
| `CRON_SECRET` | no | Enables `POST /api/delivery/cron` (header `x-cron-secret`) for hosts that can't run a cron command. On cPanel, leave it unset and schedule `scripts/delivery-cron.js` instead. |

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
| Delivery | `src/routes/delivery.routes.js`, `src/utils/delivery.js` | Per-state delivery fees quoted server-side, riders (admin-created, own app at `/rider/`), manual or automatic dispatch, pickup and drop-off verified by codes, failed attempts and returns, live rider location, public tracking, rider earnings and payouts, escrow auto-release. See `../DELIVERY_SYSTEM.md` |
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

**Variables marked `sync: false`**, which must be filled in by hand in the Render dashboard under the `vetra-api` service's Environment tab: `CORS_ORIGINS`, `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `ANTHROPIC_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `SMTP_PASS`, `EMAIL_FROM`, `PAYSTACK_SECRET_KEY`, `CHECKID_API_KEY`.

`FRONTEND_URL` is in neither list. It falls back in code to `https://vetrahq.org`. While Render is still live, set it to `https://vetra-vercel.vercel.app` there if the frontend hasn't moved yet, or email links will point at the new site early.

Saving an environment variable redeploys the service, same as a code push.

### Setting this up from scratch

1. **Get a MySQL database.** Render's free tier does not include one. Clever Cloud's "Dev" MySQL plan is free indefinitely with a small storage cap and is what this project uses; its dashboard gives you host, port, database, user, and password. Aiven works too, on trial credit rather than a permanently free plan. All of them require `DB_SSL=true`.
2. **Push to GitHub.** Render deploys from a Git connection, not an upload. `backend/` can stay a subfolder of the same repo as the frontend.
3. **New + → Blueprint** on render.com, connect the repo. Render finds `render.yaml` at the root automatically and creates the `vetra-api` free web service.
4. **Fill in the `sync: false` variables** listed above.
5. **Confirm**: `curl https://<service>.onrender.com/api/health`.

The free tier spins the service down after roughly 15 minutes without traffic and takes 30 to 60 seconds to wake on the next request. That is how the free plan works, not a bug, and avoiding it means a paid plan.

### Pointing the frontend at it

`VETRA_API_BASE` in `api-client.js` at the project root is the single place the API URL lives. It now points at the cPanel API (`https://api.vetrahq.org/api`); set it back to `https://vetra-api-11an.onrender.com/api` to use Render. Whatever origin serves the frontend must appear in `CORS_ORIGINS`. Note that a page opened over `file://` cannot work regardless of CORS configuration: the browser blocks `fetch()` from a `file://` origin before CORS is even consulted, which is why the frontend is served from Vercel even during testing.

Frontend deploys are not automatic. Pushing to GitHub updates the backend (Render watches the repo) but not the static site; Vercel here is driven from the CLI with `vercel --prod --yes`. See `ADMIN_GUIDE.md` §1.

## Adding a migration

Write a new numbered file in `migrations/` following the existing pattern: plain additive SQL (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN`, `MODIFY COLUMN` to widen an enum), no down-migration. Do not edit an already-applied file; `scripts/migrate.js` records filenames, not contents, so an edit to an applied file is silently skipped.

Then either run `npm run migrate` against the target database, or just deploy: Render runs it on start, and the cPanel Git deploy (`.cpanel.yml`) runs it on every deploy.

One caveat applies to a database where earlier migrations were applied by some other means before `schema_migrations` existed: back-fill those filenames first, or the runner will try to replay them and fail on the first duplicate column.

```sql
INSERT IGNORE INTO schema_migrations (filename) VALUES
  ('002_feature_updates.sql'), ('003_order_item_availability.sql');
```

## Moving to cPanel

This moves all of VETRA onto one cPanel hosting account: the website (public pages plus the customer, vendor, rider and admin apps) is served from the `vetrahq.org` document root, the API runs at `api.vetrahq.org` through cPanel's **Setup Node.js App** (Phusion Passenger, standard on CloudLinux hosts such as Namecheap), and the database moves off Clever Cloud onto the account's own MySQL. Render and Vercel are retired at the end.

Budget about an hour, plus a short maintenance window for the data copy.

### 1. Check the hosting plan

In cPanel, confirm **Setup Node.js App** exists under Software and offers Node **20 or newer**. Note the plan's **Entry Processes** limit on the Resource Usage page; `DB_CONNECTION_LIMIT` must stay comfortably below it (10 is a safe start on a 20-process plan).

### 2. Create the API subdomain

Domains → Create a New Domain → `api.vetrahq.org`. Let AutoSSL issue its certificate (SSL/TLS Status → Run AutoSSL if it hasn't). Use a subdomain rather than a sub-path like `vetrahq.org/api`: every route already lives under `/api`, and a sub-path mount makes Passenger strip or double the prefix.

### 3. Create the database

MySQL Database Wizard → database `vetra`, user `vetra`, strong password, **ALL PRIVILEGES**. cPanel prefixes both, so you get e.g. `cpuser_vetra`. Those prefixed names are `DB_NAME` and `DB_USER`.

### 4. Create the Node app

Setup Node.js App → Create Application:

| Field | Value |
|---|---|
| Node.js version | 20 (or the newest offered) |
| Application mode | Production |
| Application root | `vetra-api` |
| Application URL | `api.vetrahq.org` |
| Application startup file | `src/server.js` |

Leave environment variables empty there; they go in `.env` in the next step. If you choose a different root or Node version, change `APP_ROOT` / `NODE_VERSION` at the top of `.cpanel.yml` to match.

### 5. Put the code on the server

**Option A, Git (recommended, makes later deploys one click).** Git Version Control → Create → clone this repository into e.g. `repositories/vetra`. A private GitHub repo needs an SSH key: generate one under SSH Access, add its public half to the GitHub repo as a read-only **Deploy key**, and clone with the `git@github.com:...` URL. Then Manage → Pull or Deploy → **Deploy HEAD Commit**. `.cpanel.yml` copies the website into `~/vetrahq.org` (the domain's document root; change `SITE_DIR` at its top if yours differs) and `backend/` into `~/vetra-api`, installs dependencies, runs migrations, and restarts the app. Do step 6 first, or that first deploy's migration step will fail for lack of database credentials (harmless; deploy again after).

**Option B, upload.** On your machine, run `npm run package:cpanel` in `backend/`. It writes two zips at the project root: `vetra-api-cpanel.zip` (no `node_modules` or `.env`) and `vetrahq-site.zip`. In File Manager, extract the first into `~/vetra-api` and click **Run NPM Install** on the app's Setup Node.js App page; extract the second into `~/vetrahq.org`.

### 6. Create `~/vetra-api/.env`

In File Manager (enable "Show Hidden Files"), create `~/vetra-api/.env`. Start from `.env.example` and copy every secret across from the Render dashboard (vetra-api → Environment), with these changes:

```bash
DB_HOST=localhost
DB_PORT=3306
DB_NAME=cpuser_vetra
DB_USER=cpuser_vetra
DB_PASSWORD=...
DB_SSL=false
DB_CONNECTION_LIMIT=10
CORS_ORIGINS=https://vetrahq.org,https://www.vetrahq.org
FRONTEND_URL=https://vetrahq.org
SMTP_HOST=mail.vetrahq.org
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@vetrahq.org
SMTP_PASS=<that mailbox's password>
EMAIL_FROM="VETRA <noreply@vetrahq.org>"
# no PORT line: Passenger assigns it
# RESEND_API_KEY is no longer used, leave it out
```

`FRONTEND_URL` is where links in emails point (password resets, rider invites, tracking links).

**The mailbox.** Before this step, create `noreply@vetrahq.org` in cPanel → Email Accounts with a strong password. vetrahq.org already has SPF, DKIM and DMARC records in place (checked October 2026), so mail sent through it should reach inboxes. To confirm, look at cPanel → Email Deliverability, which should show every check green. Namecheap shared plans cap outgoing mail per hour (check the plan's limit). Order and delivery updates are one email per step, so that only matters at real volume.

> **Copy `ENCRYPTION_KEY` exactly from Render.** Vendor bank account numbers and KYC identity numbers are encrypted with it. A new key makes every one of them unreadable. Copy `JWT_SECRET` too if you want people to stay signed in across the move; a new one just signs everyone out once.

### 7. Create the schema

Open cPanel's Terminal (or SSH), then:

```bash
source ~/nodevenv/vetra-api/20/bin/activate
cd ~/vetra-api
npm run migrate
```

The exact `source` line is shown at the top of the app's Setup Node.js App page. Restart the app from that page and check `https://api.vetrahq.org/api/health` returns `{"ok":true}`.

### 8. Copy the data across

This copies every row from Clever Cloud into the new database and verifies row counts table by table. Run it from your own machine, since shared hosts often block outgoing database connections.

1. In cPanel → **Remote MySQL**, add your current public IP.
2. In the admin console, Settings → turn on **Maintenance mode**. That pauses signups and checkout so nothing is written to the old database mid-copy.
3. In `backend/` on your machine (the Clever Cloud values are in Render's Environment tab, the cPanel host is your server's hostname from cPanel's sidebar, not `localhost`):

```bash
SOURCE_DB_HOST=<clever cloud host> SOURCE_DB_PORT=3306 SOURCE_DB_NAME=<db> \
SOURCE_DB_USER=<user> SOURCE_DB_PASSWORD=<password> SOURCE_DB_SSL=true \
DB_HOST=<cpanel server hostname> DB_PORT=3306 DB_NAME=cpuser_vetra \
DB_USER=cpuser_vetra DB_PASSWORD=<password> DB_SSL=false \
npm run copy-data            # dry run: lists tables and row counts

# same variables, then:
npm run copy-data -- --yes   # empties the target's tables, copies, verifies
```

Variables set on the command line win over your local `.env`, so this never touches your local settings. It refuses to run if source and target are the same database. Don't continue unless it ends with `All tables match.`

4. Remove your IP from Remote MySQL afterwards.

### 9. Schedule the delivery sweep

Cron Jobs → Add New Cron Job, every 10 minutes (`*/10 * * * *`), command:

```bash
cd $HOME/vetra-api && $HOME/nodevenv/vetra-api/20/bin/node scripts/delivery-cron.js >> $HOME/vetra-cron.log 2>&1
```

This is what releases escrow after the buyer protection window, takes back rider offers nobody accepted, and retries auto-assign. Without it, delivered orders' escrow only releases when buyers tap "I received it". Check `~/vetra-cron.log` after 10 minutes for a `delivery sweep {...}` line.

### 10. Bring the website up on vetrahq.org

The site was copied into `~/vetrahq.org` by the deploy in step 5, and `api-client.js` already points at `https://api.vetrahq.org/api`, so there's nothing to build. Three things outside the code:

1. **SSL and www.** SSL/TLS Status → make sure AutoSSL covers `vetrahq.org` and `www.vetrahq.org`. If `www` doesn't resolve, add a CNAME `www → vetrahq.org` under Zone Editor (or Namecheap's Advanced DNS). The shipped `.htaccess` redirects `www` and plain `http` to `https://vetrahq.org`, turns off directory listings (the "Index of /" page the empty folder used to show), and refuses dotfiles and docs.
2. **Google Sign-In.** In Google Cloud Console → APIs & Services → Credentials → the OAuth client used by `GOOGLE_CLIENT_ID`, add `https://vetrahq.org` under **Authorized JavaScript origins**. Without it, "Continue with Google" fails on the new domain with an origin error.
3. **Smartsupp chat** (the support widget on the customer and vendor apps): if its dashboard restricts which domains may load it, add `vetrahq.org`.

Open `https://vetrahq.org`, sign in, and turn Maintenance mode back off from the admin console.

### 11. Verify, then retire Render

Sign in as a buyer, vendor, rider and admin; place a test order; confirm an upload and that the order email arrives from `noreply@vetrahq.org` (check its headers for `dkim=pass`). In Admin → Customers, open an account's login IP history and check new sign-ins record real public IPs rather than `127.0.0.1` (see the `trust proxy` note in `src/app.js`).

Leave the Render service, the Vercel project, and the Clever Cloud database alone for a week as a rollback. The old Vercel site still talks to Render, so it keeps working against the old data; anything written after cutover exists only on cPanel, so roll back only for a real outage. Then delete the Render service, the Vercel project and the Clever Cloud add-on, and remove `render.yaml`, `.vercel/` and `.vercelignore` from the repo.

### Deploying changes afterwards

With Git: push to GitHub, then Git Version Control → Manage → Pull or Deploy → **Update from Remote**, then **Deploy HEAD Commit**. New migrations run as part of that deploy, same as Render's start command did. Without Git: upload a fresh zip, Run NPM Install, run `npm run migrate` in the terminal, and Restart.

### Troubleshooting

| Symptom | Look at |
|---|---|
| "Incomplete response received from application" or a 503 | `~/vetra-api/stderr.log`, where Passenger writes the app's crash output. Usually a missing `.env` value or a failed `require`. |
| `ER_ACCESS_DENIED_ERROR` | The user wasn't added to the database with ALL PRIVILEGES, or `DB_NAME`/`DB_USER` are missing the `cpuser_` prefix. |
| `ER_USER_LIMIT_REACHED` or requests hang under load | Lower `DB_CONNECTION_LIMIT`; check Resource Usage for entry-process faults. |
| Browser console shows CORS errors | `CORS_ORIGINS` must list the exact frontend origin, `https://` included, no trailing slash. Restart after editing `.env`. |
| Emails not arriving | `stderr.log`/`stdout.log` for `[email] SMTP check failed` or `[email:failed]`. `Invalid login` means a wrong `SMTP_PASS`. A certificate error means the cert doesn't cover `mail.vetrahq.org`, so use the server hostname from cPanel's sidebar as `SMTP_HOST`. A timeout means port 465 is blocked, so try `SMTP_PORT=587` with `SMTP_SECURE=false`. The link or code is always in the log as `[email:fallback]`. |
| `.env` changes don't take effect | Restart from Setup Node.js App, or `touch ~/vetra-api/tmp/restart.txt`. |
