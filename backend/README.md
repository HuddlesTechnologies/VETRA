# VETRA API

The backend behind the VETRA frontend. This file covers running it locally and how it is deployed. For the API reference and the data model, see `../BACKEND_GUIDE.md`. For operating the live deployment (service accounts, direct database access, creating a Super Admin without the console), see `../ADMIN_GUIDE.md`.

**Live**: `https://api.vetrahq.org` on cPanel (Setup Node.js App, the account's own MySQL), serving the site at `https://vetrahq.org`. Health check: `curl https://api.vetrahq.org/api/health` returns `{"ok":true}`.

**Setting up on cPanel**, below, is the step-by-step for rebuilding the setup from scratch.

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
| `PORT` | no | Defaults to 4000. On cPanel, Passenger assigns it: leave it out of `.env`. |
| `CORS_ORIGINS` | yes in production | Comma-separated origins allowed to call the API. Unset falls back to `https://vetrahq.org` and `https://www.vetrahq.org` rather than `*`. A `file://` page cannot be listed here, see the note at the end. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | yes | `DB_PORT` defaults to 3306. |
| `DB_SSL` | depends | `true` for a remote managed MySQL host. Leave false for the cPanel account's own (localhost) MySQL. |
| `DB_CONNECTION_LIMIT` | no | Pool size, defaults to 20. Must stay at or below your hosting plan's own cap, see below. |
| `DB_QUEUE_LIMIT` | no | Defaults to 50. mysql2's own default is 0 (unbounded), which turns a traffic burst into hung requests instead of a fast, visible error. |
| `JWT_SECRET` | yes | Changing it signs everyone out immediately. |
| `JWT_EXPIRES_IN` | no | Defaults to `7d`. The absolute maximum token lifetime. |
| `SESSION_IDLE_TIMEOUT_MINUTES` | no | Defaults to 30. Server-side inactivity window enforced by `src/middleware/auth.js` against `users.last_activity_at`. |
| `LOW_STOCK_THRESHOLD` | no | Defaults to 5. Stock at or below this notifies and emails the vendor. |
| `ENCRYPTION_KEY` | yes if payouts or KYC are used | AES-256-GCM key material for vendor bank account numbers and KYC identity numbers. |
| `GOOGLE_CLIENT_ID` | for Google Sign-In | Not secret; it is embedded in the frontend's JS too. Only the Client ID is ever needed, never the Client Secret. |
| `PUBLIC_UPLOAD_DIR`, `PUBLIC_UPLOAD_URL`, `PRIVATE_UPLOAD_DIR`, `API_PUBLIC_URL` | no | Where uploads are stored on disk (`src/utils/storage.js`). The defaults match the cPanel account (`~/vetrahq.org/uploads`, served at `https://vetrahq.org/uploads`; KYC documents in `~/vetra-private-uploads`); set them only for local development. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | for real email | The cPanel mailbox emails are sent from: `premium176-2.web-hosting.com` (the server's own hostname; `mail.vetrahq.org` fails TLS, see Troubleshooting), `465`, `true`, `noreply@vetrahq.org`, and that mailbox's password. Without `SMTP_HOST`, every email is logged to the console instead and the triggering action still completes. The server logs `[email] SMTP ready` or `[email] SMTP check failed` at startup. |
| `EMAIL_FROM` | no | Defaults to `VETRA <SMTP_USER>`. Must be the `SMTP_USER` mailbox or an alias of it, or the mail server and receiving spam filters reject it. |
| `FRONTEND_URL` | no | Base URL used to build links inside emails, for example the password-reset link. Defaults in code to `https://vetrahq.org`. |
| `ANTHROPIC_API_KEY` | for the assistant | |
| `ASSISTANT_MODEL` | no | Defaults to `claude-haiku-4-5-20251001`. |
| `PAYSTACK_SECRET_KEY` | for checkout, payouts, payout accounts | All money moves through Paystack (`../PAYMENTS.md`). `sk_test_...` for testing, `sk_live_...` once Paystack has approved the account. The same key verifies webhooks. |
| `PREMBLY_API_KEY` | for vendor KYC and rider ID checks | Prembly secret key (sent as `x-api-key`). Server-side only. |
| `PREMBLY_APP_ID` | no | Only for older IdentityPass accounts that still need the `app-id` header. |
| `PREMBLY_BASE_URL` | no | Defaults to `https://api.prembly.com`. |
| `CRON_SECRET` | no | Enables `POST /api/delivery/cron` (header `x-cron-secret`) for hosts that can't run a cron command. On cPanel, leave it unset and schedule `scripts/delivery-cron.js` instead. |
| `IN_PROCESS_SWEEP` | no | The API also runs the sweep itself every 10 minutes as a backup while it's awake, skipping any tick the cron already covered. Set to `false` to turn that off. |

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
| Uploads | `src/routes/uploads.routes.js`, `src/utils/storage.js` | One multipart route, files saved on the server's disk. Photos/video (20MB cap) go into the website's `uploads/` folder, served by Apache. KYC documents (any type except video, 50MB) are stored outside the website and opened only through signed links that expire after an hour. |
| Notifications | `src/routes/notifications.routes.js` | Per-user notification list, unread count, mark read, mark all read |
| Delivery | `src/routes/delivery.routes.js`, `src/utils/delivery.js` | Per-state delivery fees quoted server-side, riders (admin-created, own app at `/rider/`), manual or automatic dispatch, pickup and drop-off verified by codes, failed attempts and returns, live rider location, public tracking, rider earnings and payouts, escrow auto-release. See `../DELIVERY_SYSTEM.md` |
| Assistant | `src/routes/assistant.routes.js` | Anthropic chat grounded in a keyword search over the real catalogue. Built and reachable, but no frontend page calls it yet |

Shared pieces: `src/utils/activityLog.js` and `src/utils/notify.js` write audit and notification rows server-side from the route that performed the mutation, both best-effort so a logging failure never breaks the action that succeeded. `src/utils/escapeHtml.js` escapes user-controlled text at write time for the four columns the frontend renders with `innerHTML`. `src/middleware/auth.js` re-reads the account row on every authenticated request, which is what makes suspensions, role changes, and `session_version` revocation take effect immediately.

## What has been checked

There is no automated test suite. What exists is manual verification, and it is worth being precise about the difference.

Baseline: `node --check` passes on every file in `src/`; the server boots and `/api/health` returns `{"ok":true}`; an auth-required route with no token returns 401 rather than crashing; a DB-dependent route with no database configured fails with a graceful 500 rather than taking the process down.

Beyond that, the full stack has been driven end to end through the real browser UI against the live deployment: the customer shopping flow (browse, cart, checkout, including confirming the idempotency key prevents a duplicate order on a repeated request), the vendor side (listing a product with a real upload, receiving an order, updating shipment status), reports (a buyer filing one, the vendor responding), and the whole admin console including the invite/verify/cancel flow and both detail pages. Test accounts and orders were cleaned out of the live database afterwards. Google Sign-In's popup was confirmed by the project owner directly, since a real Google consent screen cannot be automated.

That is still manual verification. A thin `supertest` suite over the routes above is worth adding before this sees production traffic.

**Database health.** `EXPLAIN` on the routes touched during the last review showed indexed lookups rather than scans. The one exception found was `GET /api/vendors`' `role = 'vendor' AND status = 'active'` filter, which had no indexed path, since the only other index on `users` is the `(email, role)` uniqueness constraint. `idx_users_role_status (role, status)` was added for it, because that exact filter runs on nearly every customer-facing page load.

**Connection limits.** `src/db.js` defaults `connectionLimit` to 20, Namecheap shared hosting's `maxEntryProc` cap. That cap covers every process on the account (the Node app and the cron job included), not just MySQL connections, so production sets `DB_CONNECTION_LIMIT=10` in `.env`; an env value always beats the code default.

**A timezone bug worth not reintroducing.** The pool used to set `dateStrings: true`, which made every `DATETIME` column come back as a naive `"YYYY-MM-DD HH:mm:ss"` string with no timezone marker. A browser in WAT (UTC+1) parses that as its own local time, silently shifting every timestamp exactly one hour into the past, confirmed by a clean 3,600,000ms offset in a controlled test. It is removed. mysql2's default returns real `Date` objects, which serialise as `...Z`-suffixed UTC and parse correctly in any timezone.

## Pointing the frontend at the API

`VETRA_API_BASE` in `api-client.js` at the project root is the single place the API URL lives (`https://api.vetrahq.org/api`). Whatever origin serves the frontend must appear in `CORS_ORIGINS`. A page opened over `file://` cannot work regardless of CORS configuration: the browser blocks `fetch()` from a `file://` origin before CORS is even consulted, so test the frontend through a web server.

## Adding a migration

Write a new numbered file in `migrations/` following the existing pattern: plain additive SQL (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN`, `MODIFY COLUMN` to widen an enum), no down-migration. Do not edit an already-applied file; `scripts/migrate.js` records filenames, not contents, so an edit to an applied file is silently skipped.

Then either run `npm run migrate` against the target database, or just deploy: the cPanel Git deploy (`.cpanel.yml`) runs it every time.

One caveat applies to a database where earlier migrations were applied by some other means before `schema_migrations` existed: back-fill those filenames first, or the runner will try to replay them and fail on the first duplicate column.

```sql
INSERT IGNORE INTO schema_migrations (filename) VALUES
  ('002_feature_updates.sql'), ('003_order_item_availability.sql');
```

## Setting up on cPanel

All of VETRA runs on one cPanel hosting account: the website (public pages plus the customer, vendor, rider and admin apps) is served from the `vetrahq.org` document root, the API runs at `api.vetrahq.org` through cPanel's **Setup Node.js App** (Phusion Passenger, standard on CloudLinux hosts such as Namecheap), and the database is the account's own MySQL.

Budget about an hour, plus a short maintenance window if you're copying data from an existing database.

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

In File Manager (enable "Show Hidden Files"), create `~/vetra-api/.env`. Start from `.env.example`, fill in every secret, and use these values:

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
SMTP_HOST=premium176-2.web-hosting.com   # not mail.vetrahq.org, see Troubleshooting
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

> **Rebuilding against existing data? Reuse its `ENCRYPTION_KEY` exactly.** Vendor bank account numbers and KYC identity numbers are encrypted with it. A new key makes every one of them unreadable. Reuse `JWT_SECRET` too if you want people to stay signed in; a new one just signs everyone out once.

### 7. Create the schema

Open cPanel's Terminal (or SSH), then:

```bash
source ~/nodevenv/vetra-api/20/bin/activate
cd ~/vetra-api
npm run migrate
```

The exact `source` line is shown at the top of the app's Setup Node.js App page. Restart the app from that page and check `https://api.vetrahq.org/api/health` returns `{"ok":true}`.

### 8. Copy existing data across (only when moving from another database)

This copies every row from an existing MySQL database into the new one and verifies row counts table by table. Run it from your own machine, since shared hosts often block outgoing database connections.

1. In cPanel → **Remote MySQL**, add your current public IP.
2. In the admin console, Settings → turn on **Maintenance mode**. That pauses signups and checkout so nothing is written to the old database mid-copy.
3. In `backend/` on your machine (the cPanel host is your server's hostname from cPanel's sidebar, not `localhost`):

```bash
SOURCE_DB_HOST=<old database host> SOURCE_DB_PORT=3306 SOURCE_DB_NAME=<db> \
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
cd $HOME/vetra-api && $HOME/nodevenv/vetra-api/20/bin/node scripts/delivery-cron.js >> $HOME/vetra-cron.log
```

This is what releases escrow after the buyer protection window, takes back rider offers nobody accepted, retries auto-assign, and retries failed payouts. Without it, delivered orders' escrow only releases when buyers tap "I received it". Check `~/vetra-cron.log` after 10 minutes for a `sweep {...}` line.

Only normal output goes to the log. Errors are left unredirected on purpose: cPanel emails any output a cron job doesn't redirect to the **Cron Email** address at the top of the Cron Jobs page, so set that to an inbox someone reads and a failing run emails you.

If the sweep stops or keeps failing, it shows up in three more places:

- The admin dashboard shows a red banner once it hasn't succeeded in 30 minutes, or has failed, with the last error.
- Super Admins get one email after two failures in a row (and another only after it recovers and fails again).
- `https://api.vetrahq.org/api/health/jobs` returns 503 while it's stale or failing. A free uptime monitor (UptimeRobot) checking it every 5 to 10 minutes also catches the cron entry being deleted.

The API also runs the sweep itself every 10 minutes as a backup, skipping any tick the cron already covered. Passenger stops the app after a few idle minutes, so this only helps while the site has traffic: the cron job is the real runner. `IN_PROCESS_SWEEP=false` in `.env` turns the backup off. Leave `CRON_SECRET` unset on cPanel.

### 10. Bring the website up on vetrahq.org

The site was copied into `~/vetrahq.org` by the deploy in step 5, and `api-client.js` already points at `https://api.vetrahq.org/api`, so there's nothing to build. Three things outside the code:

1. **SSL and www.** SSL/TLS Status → make sure AutoSSL covers `vetrahq.org` and `www.vetrahq.org`. If `www` doesn't resolve, add a CNAME `www → vetrahq.org` under Zone Editor (or Namecheap's Advanced DNS). The shipped `.htaccess` redirects `www` and plain `http` to `https://vetrahq.org`, turns off directory listings (the "Index of /" page the empty folder used to show), and refuses dotfiles and docs.
2. **Google Sign-In.** In Google Cloud Console → APIs & Services → Credentials → the OAuth client used by `GOOGLE_CLIENT_ID`, add `https://vetrahq.org` under **Authorized JavaScript origins**. Without it, "Continue with Google" fails on the new domain with an origin error.
3. **Smartsupp chat** (the support widget on the customer and vendor apps): if its dashboard restricts which domains may load it, add `vetrahq.org`.

Open `https://vetrahq.org`, sign in, and turn Maintenance mode back off from the admin console.

### 11. Verify

Sign in as a buyer, vendor, rider and admin; place a test order; confirm an upload and that the order email arrives from `noreply@vetrahq.org` (check its headers for `dkim=pass`). In Admin → Customers, open an account's login IP history and check new sign-ins record real public IPs rather than `127.0.0.1` (see the `trust proxy` note in `src/app.js`).

### Uploaded files

Every upload is stored on this account's disk (`src/utils/storage.js`): photos and video in `~/vetrahq.org/uploads/` (served by Apache at `https://vetrahq.org/uploads/...`), KYC documents in `~/vetra-private-uploads/` (outside the website, reachable only through signed links the API hands to the vendor and admins). `.cpanel.yml` creates both folders and its site sync is told never to touch `uploads/`. Back up both folders with the database; they count toward the hosting plan's disk quota (cPanel → Disk Usage).

Nothing is stored anywhere else. Files from before the move (on Cloudinary) and Google profile photos are brought here by `scripts/move-uploads-to-cpanel.js`, which `.cpanel.yml` runs on every deploy: it scans every text column of every table, downloads each file, stores it here and repoints the row. Its output is appended to `~/vetra-move-uploads.log`. Files it can't fetch are listed there and retried on the next deploy. Keep the `CLOUDINARY_*` lines in `.env` until the log says "Nothing left on Cloudinary or Google": they let it fetch KYC documents and PDFs that Cloudinary blocks on their public links. After that, delete those lines and the Cloudinary account. To run it by hand:

```
cd ~/vetra-api && $HOME/nodevenv/vetra-api/20/bin/node scripts/move-uploads-to-cpanel.js --dry-run
cd ~/vetra-api && $HOME/nodevenv/vetra-api/20/bin/node scripts/move-uploads-to-cpanel.js
```

New uploads can't point elsewhere: every field that stores a file link only accepts links on `PUBLIC_UPLOAD_URL` (`src/utils/safeUrl.js`), and "Continue with Google" saves a copy of the profile photo here.

### Permanent bans

Admin → a customer's or vendor's page → **Permanent ban** (Moderators and Super Admins can ban, only a Super Admin can lift). A ban signs the account out, delists a vendor's products, emails them, and blocks the person's email (including Gmail dot/`+` variants), phone, devices, NIN/BVN/licence, CAC number, payout bank account and payment cards everywhere they could come back: signup, Google signup, profile changes, KYC (a matching NIN/BVN bans the new account automatically), payout setup and checkout (a banned card's payment is refunded, no order). The same panel lists every other account that shares any of those details. Code: `src/utils/bans.js`, `src/utils/identifiers.js`.

After the first deploy with bans, record the details of accounts that already existed (once):

```
cd ~/vetra-api && $HOME/nodevenv/vetra-api/20/bin/node scripts/backfill-identifiers.js --cards
```

### Deploying changes afterwards

**Automatically (recommended).** `deploy/cpanel-autodeploy.sh` checks GitHub every few minutes and, when `main` has a new commit, pulls it into the Git Version Control clone and runs **Deploy HEAD Commit** for you (frontend and backend, migrations included, via `.cpanel.yml`). Needs Option A's Git clone and deploy key. Cron Jobs → Add New Cron Job, every 5 minutes (`*/5 * * * *`), command:

```
/bin/bash $HOME/repositories/vetra/deploy/cpanel-autodeploy.sh >> $HOME/vetra-autodeploy.log 2>&1
```

Change `repositories/vetra` if you cloned somewhere else (or prefix the command with `REPO_DIR=$HOME/your/path`), and add `BRANCH=yourbranch` to deploy a branch other than `main`. `~/vetra-autodeploy.log` gets one line per deploy (nothing when there's nothing new); each deploy's own output is under Git Version Control → Manage → Pull or Deploy → history. The clone on the server is treated as a copy of GitHub: anything edited there directly is discarded on the next deploy.

**By hand.** Push to GitHub, then Git Version Control → Manage → Pull or Deploy → **Update from Remote**, then **Deploy HEAD Commit**. New migrations run as part of that deploy. Without Git: upload a fresh zip, Run NPM Install, run `npm run migrate` in the terminal, and Restart.

### Troubleshooting

| Symptom | Look at |
|---|---|
| "Incomplete response received from application" or a 503 | `~/vetra-api/stderr.log`, where Passenger writes the app's crash output. Usually a missing `.env` value or a failed `require`. |
| `ER_ACCESS_DENIED_ERROR` | The user wasn't added to the database with ALL PRIVILEGES, or `DB_NAME`/`DB_USER` are missing the `cpuser_` prefix. |
| `ER_USER_LIMIT_REACHED` or requests hang under load | Lower `DB_CONNECTION_LIMIT`; check Resource Usage for entry-process faults. |
| Browser console shows CORS errors | `CORS_ORIGINS` must list the exact frontend origin, `https://` included, no trailing slash. Restart after editing `.env`. |
| Emails not arriving | `stderr.log`/`stdout.log` for `[email] SMTP check failed` or `[email:failed]`. `Invalid login` means a wrong `SMTP_PASS`. `Hostname/IP does not match certificate's altnames` means `SMTP_HOST` is `mail.vetrahq.org`: the mail server presents Namecheap's shared `*.web-hosting.com` certificate, so use the server hostname (`premium176-2.web-hosting.com`, also shown in cPanel's sidebar) instead. A timeout means port 465 is blocked, so try `SMTP_PORT=587` with `SMTP_SECURE=false`. The link or code is always in the log as `[email:fallback]`. |
| `.env` changes don't take effect | Restart from Setup Node.js App, or `touch ~/vetra-api/tmp/restart.txt`. |
