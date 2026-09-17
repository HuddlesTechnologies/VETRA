# VETRA — Admin & Operations Guide

This is the one document written for whoever actually **operates** VETRA day to day — not a developer reading the code, and not someone building new features. `BACKEND_GUIDE.md` explains the architecture and why it's built the way it is; `backend/README.md` is for setting the project up locally; `DOCUMENTATION.md` explains what every page does. **This one explains the live services VETRA actually runs on, how the database is put together and why, how to reach it directly when the admin console itself can't help (e.g. locked out, no Super Admin left, need to look something up by hand), and how to create a Super Admin account without ever opening the console.**

Nothing here is a build plan or a feature list — it's a runbook. Keep it updated whenever a service, credential, or piece of the schema changes in a way that would make this page wrong.

---

## 1. The services VETRA runs on

Every one of these is a separate account, on a separate site, with its own login — there's no single dashboard that shows all of them at once. This table is the map.

| Service | What it does for VETRA | Where you manage it |
|---|---|---|
| **GitHub** | Holds the source code (`HuddlesTechnologies/VETRA`). Pushing to `main` is what triggers Render to redeploy the backend. | github.com — sign in with whichever account has access to the `HuddlesTechnologies` org. |
| **Render** | Runs the backend API (`backend/`) as a live web service at `https://vetra-api-11an.onrender.com`. Free tier. | dashboard.render.com → the `vetra-api` service. |
| **Vercel** | Serves the static frontend (everything outside `backend/` — the public site, `customer/`, `vendor/`, `admin/`) at `https://vetra-vercel.vercel.app`. | vercel.com → the `vetra-vercel` project. |
| **Clever Cloud** | Hosts the MySQL database every piece of real data lives in. Free "Dev" plan. **This is the test-phase database** — `BACKEND_GUIDE.md` §1 names Namecheap shared hosting (cPanel) as the actual chosen deployment target for the frontend, backend, *and* database; Clever Cloud/Render/Vercel are the current staging setup, not the final one. | console.clever-cloud.com → the MySQL add-on attached to this app. |
| **Cloudinary** | Stores every uploaded file — avatars, cover photos, KYC documents, product images/video, site banners. Nothing is ever written to local disk. | cloudinary.com dashboard. |
| **Resend** | Sends every real email — password resets, admin invite codes, new-admin temp passwords, admin role-change/removal notices. | resend.com dashboard. |
| **Anthropic (Claude)** | Powers the AI shopping assistant chat feature. | console.anthropic.com. |
| **Smartsupp** | A live-chat widget embedded on every page (the little chat bubble). Entirely separate from VETRA's own `customer/chat.html` feature — this is third-party support chat, not part of the app's own data. | smartsupp.com dashboard. |

### How a change actually goes live

This trips people up, so it's worth stating plainly:

- **Backend changes** (anything in `backend/`): pushing to `main` on GitHub is enough — Render watches the repo and redeploys automatically, usually within about 30-60 seconds of the push landing.
- **Frontend changes** (everything else — HTML/CSS/JS at the project root, `customer/`, `vendor/`, `admin/`): pushing to GitHub does **not** automatically update the live site. Vercel here is driven from the command line, not from a GitHub integration — you have to run `vercel --prod --yes` from a machine that has the Vercel CLI installed and is linked to this project (see `.vercel/project.json` at the repo root) *after* pushing. Forgetting this step is the single most common reason "I pushed a fix but the live site still shows the old version."

### Reconnecting or rotating a service

Every one of these is wired in through an environment variable read at server startup — nothing is hard-coded to a specific account beyond that. To reconnect, replace, or rotate any of them:

1. Get the new credential(s) from that service's own dashboard.
2. Render dashboard → `vetra-api` service → **Environment** → update the matching variable(s) (table below).
3. Save. Render redeploys automatically on an environment variable change, same as a code push.

| Service | Env var(s) | Notes on rotating |
|---|---|---|
| Database (Clever Cloud, or any MySQL host) | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` | Moving to a *different* database entirely means running `npm run migrate` (from `backend/`, with a local `.env` pointed at the new database) before the app can use it — see §3. |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Rotating the API key/secret in Cloudinary's dashboard doesn't touch any file already uploaded — only new uploads use the new credentials. |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM` | `EMAIL_FROM` must be an address on a domain *verified in that Resend account* (Domains tab) — an unverified domain, or a typo in it, makes every email attempt fail (logged server-side, see §6). Rotating the API key alone doesn't require re-verifying the domain. |
| Anthropic | `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL` | The assistant simply stops responding (with a real error, not a silent failure) if the key is invalid or the account runs out of credit. |
| Google Sign-In | `GOOGLE_CLIENT_ID` | This one is *not secret* — it's also embedded directly in the frontend's own JS (`google-signin.js`), so it's fine to see in plain text in the browser. Changing it means creating a new OAuth Client ID in Google Cloud Console and updating both this env var and `google-signin.js`'s copy. |
| JWT signing | `JWT_SECRET`, `JWT_EXPIRES_IN` | **Rotating `JWT_SECRET` immediately signs every existing user out** — every previously-issued token fails signature verification the moment it's checked. That's the intended effect if you're rotating it *because* it leaked; otherwise, don't touch it casually. |
| Payout encryption | `ENCRYPTION_KEY` | Encrypts vendor bank account numbers at rest (AES-256-GCM). **Rotating this without a migration step makes every already-saved payout account unreadable** — the ciphertext was encrypted under the old key. If this ever needs to change, every vendor would need to re-save their payout account afterward. |
| Frontend origin | `CORS_ORIGINS`, `FRONTEND_URL` | `CORS_ORIGINS` is which frontend origins are allowed to call the API at all — if this doesn't include wherever the frontend is actually served from, every request fails in the browser with a CORS error, not a clean API error message. `FRONTEND_URL` is only used to build links inside emails (e.g. the password-reset link). |

### Disconnecting a service

There's no "off switch" API for most of these — disconnecting one means either deleting the env var(s) on Render (the feature degrades gracefully, see below) or actually closing the account on that service's own site.

- **Cloudinary removed/misconfigured**: file uploads fail with a real error; nothing else in the app breaks.
- **Resend removed/misconfigured**: every email attempt fails *silently to the end user* — the action it was attached to (invite, reset, removal notice) still completes, the email is just logged to Render's server console instead of sent (`grep` the logs for `[email:not-configured]` or `[email:failed]`). See `backend/src/utils/mailer.js`.
- **Anthropic removed**: the AI assistant chat returns an error; nothing else in the app is affected.
- **Google Sign-In removed** (`GOOGLE_CLIENT_ID` unset): "Continue with Google" fails; regular email/password signup and signin are unaffected.
- **The database itself cannot be "disconnected" without taking the entire app down** — every route depends on it.

---

## 2. How the database is set up, and why

One MySQL database, 14 tables, no ORM — every query in `backend/src/routes/*.js` is plain SQL via `mysql2/promise`. The full schema lives in `backend/migrations/001_init.sql`; this section explains the *reasoning* behind the shape of it, which the migration file itself doesn't always spell out.

### One `users` table for all three account types

Buyers, vendors, and admins are all rows in the same `users` table, distinguished only by the `role` column (`buyer` | `vendor` | `admin`). This avoids three separate tables with three separate copies of auth/session/password-reset logic for what's fundamentally the same "an account that can sign in" concept. Vendor-only fields (`store_name`, `store_category`, etc.) and admin-only fields (`admin_role`) just sit as `NULL` on rows that don't need them, rather than living in separate `vendor_profiles`/`admin_profiles` tables — simpler at this scale, revisit only if those columns actually grow numerous enough that the sparseness becomes wasteful.

**Full current `users` schema:**

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | A UUIDv7, not v4 — time-ordered on purpose (see below). |
| `role` | `ENUM('buyer','vendor','admin')` | Which of the three apps this account belongs to. |
| `name` | `VARCHAR(190)` | |
| `email` | `VARCHAR(190)` | Unique **per role** — the same email can exist as both a buyer and a vendor (two separate rows), just never twice within the same role. |
| `phone`, `address` | `VARCHAR` | Nullable — required at signup by the frontend, but the column itself doesn't enforce it. |
| `state` | `VARCHAR(60)` | One of Nigeria's 36 states or the FCT. Required at signup for every new buyer/vendor (enforced in `auth.routes.js`, not by the column). |
| `password_hash` | `VARCHAR(255)` | **bcrypt, one-way.** There is no way to "look up" a user's password — see §4's note on this. |
| `status` | `ENUM('active','suspended','pending','rejected','deleted')` | `pending` = a vendor awaiting admin approval. `suspended` = admin-initiated suspension *or* the account holder's own "Deactivate" — same end-state either way, reversible. `rejected` = a vendor application denied. `deleted` = the account holder's own "Delete account" (vendor only, today) — terminal, not reversible; see the `deleted` note below. |
| `signup_method` | `VARCHAR(40)` | `'email'` or `'google'`. |
| `avatar_url`, `store_cover_url` | `VARCHAR(500)` | Cloudinary URLs, never a local path or a base64 blob. |
| `store_name`, `store_category`, `store_description` | | Vendor-only, `NULL` for buyers/admins. |
| `admin_role` | `ENUM('Super Admin','Moderator','Support')` | Admin-only, `NULL` for buyers/vendors. This is what every `requireAdminRole(...)` check in the backend gates on. |
| `payout_bank_name`, `payout_account_name` | `VARCHAR` | Vendor-only, plain text. |
| `payout_account_number_enc` | `VARCHAR(255)` | **The vendor's bank account number, AES-256-GCM encrypted** (`src/utils/encryption.js`, key = `ENCRYPTION_KEY`). Never stored or returned in plaintext — every API response only ever shows a masked `•••• 1234` form, derived by decrypting server-side and masking, never by storing a masked copy. |
| `last_login_at`, `created_at` | `DATETIME` | Real UTC timestamps — see the timezone note below. |

**What `status = 'deleted'` actually means.** A vendor deleting their own account doesn't remove the row — it can't, without breaking every past order/report/review that legitimately still references that vendor for someone else's records. Instead, `POST /api/auth/delete-account` scrubs personal fields (`name` → `"Deleted User"`, `email` → a unique `deleted-<id>@vetra.deleted` placeholder, `phone`/`address`/`avatar_url`/store fields/payout fields → cleared) and delists every one of their products (`products.status = 'removed'`), all in one transaction. The row still exists — for FK integrity — but nobody can sign into it again, and it shows up as "Deleted User" wherever it's still referenced.

### Why the IDs look like they do (UUIDv7)

Every table's primary key is a `CHAR(36)` UUID, generated in `backend/src/utils/id.js` — but not `crypto.randomUUID()`. That function makes a UUIDv4 (fully random), which InnoDB (MySQL's storage engine) handles badly as a clustered-index primary key: random insert order means every insert can land anywhere in the index's B-tree, causing constant page splits and index fragmentation as a table grows. `id.js` instead hand-builds a **UUIDv7** — the first 48 bits are the current Unix timestamp in milliseconds, the rest is random — so new rows are inserted in roughly chronological order, which InnoDB handles efficiently, while the format on disk is identical to a v4 UUID (same 36-character dashed string), so nothing else in the schema or code had to change.

### Why money is stored the way it is

Every price/total column (`products.price`, `orders.total`) is an `INT` counted in **kobo** (1 naira = 100 kobo), never a `DECIMAL` or `FLOAT` naira value. Storing currency as a float risks classic rounding-error bugs (₦0.1 + ₦0.2 not exactly equaling ₦0.3 in binary floating point); storing it as an integer count of the smallest unit sidesteps that entirely. The conversion only ever happens at the UI boundary — `api-client.js`'s `formatNaira()`/`nairaToKobo()` are the only two places in the whole codebase that multiply or divide by 100. If you're ever looking at a raw number in the database and it looks 100x too large, that's why.

### Timestamps are real UTC now (a fix worth knowing about)

Until recently, the database connection had `dateStrings: true` set (`backend/src/db.js`), which made every `DATETIME` column come back from a query as a plain string like `"2026-09-16 21:04:32"` — no timezone marker at all. A browser in Nigeria (WAT, UTC+1) parsing that string interprets it as *its own local time*, which silently shifted every displayed timestamp exactly one hour into the past (confirmed directly: a fresh event showed "1h ago" in the admin activity feed instead of "just now"). This is fixed — the connection now returns real JavaScript `Date` objects, which serialize over the API as a proper `...Z`-suffixed UTC string that any browser, in any timezone, parses correctly. If you ever see a timestamp that's off by a suspiciously round number of hours again, this class of bug (a naive date string with no timezone marker, parsed by something that assumes local time) is the first thing to suspect.

### Every table, one line each

| Table | Purpose |
|---|---|
| `users` | Every buyer, vendor, and admin — see above. |
| `products` | Vendor listings. `status`: `active` \| `out_of_stock` \| `removed`. |
| `orders`, `order_items` | Real orders from real checkouts. `orders.escrow_status` (`held`/`released`/`refunded`) tracks whether the vendor's money has actually cleared. |
| `reviews` | One per completed order (`UNIQUE KEY` on `order_id`) — "verified purchase" is real, not a label. |
| `reports` | The moderation queue — a buyer's complaint against a vendor, or a system auto-flag on a suspicious listing. |
| `report_evidence` | A vendor's response/evidence attached to a report against them. |
| `activity_log` | The audit trail every admin/vendor/system mutation writes to. Now prunable (Super Admin only) — see §5's note on that. |
| `vendor_kyc` | One row per vendor, created on first submission — business verification (CAC number + ID/CAC document URLs) and its review status. |
| `admin_invites` | The invite-and-verify flow for adding a new admin — a 6-digit code, hashed, with a 15-minute expiry. |
| `password_reset_tokens` | Single-use tokens behind the "forgot password" email link, SHA-256 hashed. |
| `notifications` | Real per-user notifications for buyers/vendors (order updates, KYC decisions, account status changes). |
| `site_banners` | The homepage/dashboard promo carousel images, admin-managed. |
| `platform_settings` | One single row (`id` always `1`) — the five Platform Controls toggles on `admin/settings.html`. |

### Foreign keys: what deletes cascade, and what doesn't

Most foreign keys here are the MySQL default (`RESTRICT` — you can't delete a row something else still points to). Two are deliberately different, and it matters if you're ever deleting rows by hand:

- `activity_log.actor_user_id` and `admin_invites.invited_by_user_id` are both `ON DELETE SET NULL`. Removing a user (via the admin console's "Remove" button, or by hand) doesn't fail just because they have login history or once sent an invite — those rows survive with the actor reference cleared instead. (This used to be `RESTRICT`, which meant an admin who had ever signed in literally could not be removed from the team at all — every removal attempt failed with a generic error. Fixed directly in the schema.)
- Everything else referencing `users.id` (orders, products, reviews, reports, KYC, notifications, etc.) is still `RESTRICT` — deliberately, since a real order or review disappearing because a user's row got deleted would be a much worse outcome than the delete simply failing.

---

## 3. Creating a new Super Admin without the console (via code)

Normal path: an existing Super Admin uses `admin/settings.html`'s "Add Admin" flow (invite → 6-digit email code → the new admin gets a temp password by email). **This section is for when that's not possible** — nobody has console access, or you need one urgently and don't want to wait on email delivery.

You need: a local `backend/.env` file with real `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` (and `DB_SSL=true` for Clever Cloud) pointed at the live database, and Node installed. From the `backend/` directory:

```bash
node -e "
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

(async () => {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 1,
  });

  const id = crypto.randomUUID();               // a v4 UUID here is fine — see §2's note on why v7 matters for high-volume tables, which this isn't
  const email = 'REPLACE_WITH_REAL_EMAIL';
  const name = 'REPLACE_WITH_REAL_NAME';
  const plainPassword = 'REPLACE_WITH_A_REAL_STRONG_PASSWORD';
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  await pool.query(
    \`INSERT INTO users (id, role, name, email, password_hash, admin_role, status)
     VALUES (?, 'admin', ?, ?, ?, 'Super Admin', 'active')\`,
    [id, name, email, passwordHash]
  );

  console.log('Created Super Admin:', email, '(id:', id + ')');
  await pool.end();
})();
"
```

Replace the three `REPLACE_WITH_*` values before running it. Sign in at `admin/login.html` with that email/password immediately afterward.

**Do this carefully:**
- The password goes into this command in **plain text**, which means it lands in your shell's history file. Either pick a password you're going to change immediately after first sign-in, or clear it from history afterward (`history -d <line>` in bash/zsh, or just don't reuse this exact password anywhere else).
- Don't run this against the live database from a machine/connection you don't trust — it's a direct, unauthenticated (from the app's perspective) write to the `users` table.
- This bypasses every one of the invite flow's protections (email verification, the person actually receiving and typing back a code) — only do this when you're certain the email address is really going to the right person.

---

## 4. Finding users and their details in the database

There's no admin-console search that reaches into raw database fields the UI doesn't surface (payout account details, the exact `admin_role` enum value, `signup_method`, etc.) — for that, you're querying directly. Same connection setup as §3 (a local `.env` pointed at the live database), then plain SQL:

```sql
-- Find one user by email (remember: same email can exist once per role)
SELECT * FROM users WHERE email = 'someone@example.com';

-- List every admin and their role
SELECT id, name, email, admin_role, status FROM users WHERE role = 'admin';

-- List suspended vendors
SELECT id, name, email, store_name FROM users WHERE role = 'vendor' AND status = 'suspended';

-- A vendor's real (unmasked) payout account — see the decrypt note below
SELECT payout_bank_name, payout_account_number_enc, payout_account_name
FROM users WHERE id = '...';
```

**What you'll actually see, field by field:**
- `password_hash` — a bcrypt hash (starts with `$2a$` or `$2b$`). **This cannot be reversed to recover the real password** — that's the entire point of hashing it. If someone's locked out, the only options are a real password reset (the email flow) or directly `UPDATE users SET password_hash = ?` with a freshly bcrypt-hashed new password (the same `bcrypt.hash(plain, 10)` call from §3's script) — never write a plaintext value into this column.
- `payout_account_number_enc` — AES-256-GCM ciphertext, not human-readable as-is. To actually read it, use the same `decrypt()` function the app itself uses (`backend/src/utils/encryption.js`), with the live `ENCRYPTION_KEY`:
  ```bash
  node -e "
  require('dotenv').config();
  const { decrypt } = require('./src/utils/encryption');
  console.log(decrypt('PASTE_THE_ENC_VALUE_HERE'));
  "
  ```
  (run from `backend/`, with `.env` present). There is deliberately no route in the API that returns this decrypted — this is a direct-database-access-only capability, by design.
- Every other column (`name`, `email`, `phone`, `address`, `store_name`, etc.) is plain, human-readable text — nothing else in `users` is encrypted or hashed.

---

## 5. Pruning the activity log

`admin/activity.html` has a "Clear All" button and a per-entry "✕" — both Super Admin only, both real deletes against `activity_log`. Two things worth knowing if you're the one clicking them:

- **This is genuinely irreversible** — there's no soft-delete, no trash, nothing to restore from inside the app. If you need a copy of the log before clearing it, export it first (`SELECT * FROM activity_log` via direct DB access, same connection pattern as above).
- **Clearing the log leaves no trace of itself, by design** — neither route writes a fresh `activity_log` row afterward. This was a deliberate choice: clearing the log is meant to actually clear it, not leave a new entry behind every time.

---

## 6. A few operational gotchas worth knowing

- **The database user has its own connection cap (`max_user_connections`), separate from the app's connection pool — and Namecheap has a related but distinct cap of its own.** Clever Cloud (the current test-phase database — see §1's note above on the planned move to Namecheap) caps this specific database user at 5 concurrent connections. Namecheap's standard shared hosting plan doesn't publish a MySQL-specific number the same way — instead it caps **maxEntryProc** (concurrent processes) for the whole cPanel account at 20, a CloudLinux/LVE limit that the Node app itself, its DB connections, and anything else cPanel runs for the account all draw from together, not a number the pool can assume it owns by itself. `src/db.js`'s pool is `Number(process.env.DB_CONNECTION_LIMIT || 20)` — the default (20) targets that Namecheap ceiling, since that's where this database is actually headed; it is **not** safe for Clever Cloud, so `render.yaml` explicitly pins `DB_CONNECTION_LIMIT` to `"5"` for the live Render deployment, overriding that default. If Render's Blueprint sync isn't picking up `render.yaml` changes automatically, set `DB_CONNECTION_LIMIT=5` directly in the Render dashboard for the `vetra-api` service instead. Once the database itself moves to Namecheap, that override can simply be removed (letting the 20 default apply) — but double-check the actual plan's documented `maxEntryProc` value first (cPanel's "Resource Usage" page shows it directly) rather than trusting this guide's number to still be current, and keep the pool comfortably under it since the app needs some of that headroom for non-DB work too. If you ever hit `ER_USER_LIMIT_REACHED` running a one-off script against the live database (each opens its own short-lived pool, per this guide's own examples) — wait a few seconds for old connections to close, and pass `connectionLimit: 1` to that script's own `mysql.createPool(...)` call.
- **Applying a schema change to the live database.** `backend/migrations/001_init.sql` is only ever run automatically once, when a database is first set up (`npm run migrate`) — it's full of `CREATE TABLE IF NOT EXISTS` statements, which do nothing to a table that already exists, even if the file's definition of that table has since grown a new column. Every schema change made to the *already-running* live database this project has needed so far was applied by hand: connect with the pattern in §3, then run the equivalent `ALTER TABLE ... ADD COLUMN` / `ALTER TABLE ... MODIFY COLUMN` / `ALTER TABLE ... DROP FOREIGN KEY` + `ADD FOREIGN KEY` directly, and *also* update `001_init.sql` to match — so a brand-new database created from scratch ends up with the same final shape as the live one, without needing to replay every incremental change in order.
- **Email failures are silent to whoever triggered the action, by design** — an admin who clicks "Reset Password" for a customer always sees "Reset link sent," whether or not the email actually went out, because the alternative (surfacing a delivery failure) would leak information to someone who may not need it. The real signal is in Render's server logs: search for `[email:failed]` (a real send attempt that Resend rejected — reason included) or `[email:not-configured]` (no `RESEND_API_KEY` set at all). Every one of these log lines includes the actual code/link/password as a fallback, so nothing is unrecoverable just because the email didn't land.
- **Rate limiting on auth endpoints.** `src/middleware/rateLimit.js` caps signin (10/15min), admin-signin (5/15min), signup (20/hour), and password-reset-link redemption (10/15min) per IP, each independently. Depends on `app.js`'s `app.set("trust proxy", 1)` to see the real client IP behind Render's reverse proxy — without it, every visitor would look like the same IP and one abusive client could lock everyone out.
- **User-controlled text is escaped at write time, not render time.** `activity_log.message`, `reports.reason`, and `report_evidence.response_text` all get rendered via `innerHTML` in `admin/`/`vendor/` frontend JS with no escaping of their own — a vendor's store name or a buyer's report reason used to be able to contain a real `<script>`/`<img onerror=...>` payload and run in an admin's or vendor's own session. Fixed by escaping every such value with `backend/src/utils/escapeHtml.js` right before it's written to the database (see that file's header comment). If a new route ever writes user-controlled text into one of these three columns — or into `notifications.message` — it needs the same treatment; there's no automatic protection at render time.
