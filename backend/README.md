# VETRA API

The real backend behind the VETRA frontend — see `../BACKEND_GUIDE.md` for the full plan this implements (data model reasoning, security notes, what's deliberately not built yet). This file is just the practical "how do I run this" reference.

## Stack

Express + `mysql2` (no ORM — plain SQL, kept deliberately simple), JWT auth (`jsonwebtoken` + `bcryptjs`), Anthropic's SDK for the AI shopping assistant. `bcryptjs` (pure JS) is used instead of `bcrypt` specifically because it doesn't need a native compiler toolchain — matters on shared hosting.

## Local setup

1. `npm install`
2. `cp .env.example .env` and fill in real values — a MySQL database (local or already provisioned), a `JWT_SECRET` (generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`), and an `ANTHROPIC_API_KEY` if you're testing the assistant.
3. `npm run migrate` — runs everything in `migrations/` against the database in your `.env`. Safe to re-run (every statement is `CREATE TABLE IF NOT EXISTS`).
4. `npm start` (or `npm run dev` for auto-restart on file changes). Confirm it's up: `curl http://localhost:4000/api/health` → `{"ok":true}`.

## What's implemented

| Area | File | Covers |
|---|---|---|
| Auth | `src/routes/auth.routes.js` | Buyer/vendor signup+signin, admin signin, JWT issuing |
| Products | `src/routes/products.routes.js` | Public browse/search, vendor create/edit/remove |
| Orders | `src/routes/orders.routes.js` | Checkout (signed-in or guest), customer order history, vendor order list + shipment updates |
| Reviews | `src/routes/reviews.routes.js` | Per-vendor review list + submission, gated on a real completed order |
| Reports | `src/routes/reports.routes.js` | Admin moderation queue + status changes, vendor read-only view + evidence submission |
| Admin | `src/routes/admin.routes.js` | Customer/vendor management, stats, role-scoped activity log, admin team + invite/verify |
| AI assistant | `src/routes/assistant.routes.js` | Chat endpoint grounded in a keyword search over the product catalog |

Every mutating admin/vendor action writes an `activity_log` row server-side (`src/utils/activityLog.js`) — see `BACKEND_GUIDE.md` §6 point 7 for why that's not left to the client.

## What's deliberately stubbed

A few things are wired up structurally but marked `TODO` in the code rather than fully built, because they depend on a provider that isn't chosen/configured yet:

- **Email delivery** (password resets, admin invite codes) — currently `console.log`'d where a real send would go. Search the codebase for `TODO: email` to find every spot.
- **Guest-checkout toggle enforcement** — `POST /api/orders` always allows a guest today; wiring the actual on/off effect of `admin/settings.html`'s toggle is a small follow-up once that setting has somewhere real to live.
- **48-hour auto-confirm on delivery** (escrow auto-release) — needs a scheduled job (cron), not a request handler; not built yet.
- **Semantic product search** — the assistant currently grounds itself in a plain keyword `LIKE` search (see `src/routes/assistant.routes.js`'s comment for why that's the deliberate starting point). The `products.description_embedding` column already exists in the schema for when this is worth adding.

## Deploying to Namecheap shared hosting (cPanel)

1. **cPanel → Setup Node.js App** → create a new application, point its "Application root" at wherever you upload this `backend/` folder, and its "Application startup file" at `src/server.js`. Pick a Node version (18+ works fine — this doesn't use anything newer).
2. **cPanel → MySQL Databases** → create a database and a user with full privileges on it (the wizard gives you the exact `DB_NAME`/`DB_USER` values, usually prefixed with your cPanel username).
3. In the Node app's cPanel page, add the same variables `.env.example` lists as **environment variables** through cPanel's UI, not a committed `.env` file — `DB_HOST` is almost always `localhost` on shared hosting.
4. Use cPanel's "Run NPM Install" button (or its built-in terminal) to install dependencies inside that environment, then run `npm run migrate` the same way to create the tables.
5. Start/restart the app from the same cPanel page. It's now reachable at whatever subdomain/path you pointed it at in step 1 — set that as the frontend's API base URL.

The frontend itself (plain static files) doesn't go through any of this — it just uploads to the hosting account's document root as always.
