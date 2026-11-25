# VETRA — Site Documentation

What VETRA is, how the pieces connect, and what **every file in the repository** is for. Last checked against the code on 2026-11-25.

The other guides go deeper on one area each:

| Guide | Covers |
|---|---|
| `BACKEND_GUIDE.md` | The API: every route, every table, authentication, security, integrations |
| `backend/README.md` | Running the API locally, environment variables, setting up and deploying on cPanel |
| `ADMIN_GUIDE.md` | Operating the live site: services, the database by hand, creating a Super Admin, gotchas |
| `DELIVERY_SYSTEM.md` | Riders, pickup and delivery codes, dispatch, escrow release |
| `PAYMENTS.md` | Flutterwave checkout, payouts, refunds, the webhook |

The `.pdf` files next to each guide are printed copies. They are not deployed (`.cpanel.yml` and `.htaccess` both exclude `*.pdf`) and are only as current as their last export; the `.md` file is always the source.

---

## 1. What VETRA is

A marketplace for Nigeria: **buyers** shop from verified **vendors**, VETRA's own **riders** deliver, and VETRA **staff** run it from an admin console. Buyers pay through Flutterwave; the money is held in escrow until the buyer confirms delivery (or the protection window passes), then the vendor is paid by transfer, minus VETRA's commission.

Five front-end areas, one API:

| Area | Folder | Who | Signs in at |
|---|---|---|---|
| Public site | project root | Everyone | — |
| Buyer app | `customer/` | Buyers (guests can browse) | `signin.html` |
| Vendor app | `vendor/` | Sellers | `signin.html` (Vendor tab) |
| Rider app | `rider/` | Delivery riders | `rider/login.html` |
| Admin console | `admin/` | VETRA staff (Super Admin, Moderator, Support) | `admin/login.html` |
| API | `backend/` | Every area above | — |

---

## 2. How it fits together

```
                          https://vetrahq.org  (static files, cPanel document root)
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │ public pages   customer/   vendor/   rider/   admin/                              │
 │      │             │          │         │        │                                 │
 │      └─────────────┴──────────┴────┬────┴────────┘                                 │
 │                                    ▼                                               │
 │                             api-client.js  (VetraAPI: one fetch wrapper,           │
 │                                    │        one token per role in localStorage)    │
 └────────────────────────────────────┼──────────────────────────────────────────────┘
                                      │ HTTPS, JSON, Authorization: Bearer <JWT>
                                      ▼
                          https://api.vetrahq.org/api   (backend/, Node + Express)
                          app.js → middleware → routes/*.routes.js → utils/*.js
                                      │
        ┌──────────────┬──────────────┼───────────────┬──────────────┬──────────────┐
        ▼              ▼              ▼               ▼              ▼              ▼
     MySQL        local disk       Flutterwave      Prembly       cPanel SMTP    Anthropic
   (db.js)      (storage.js)    (flutterwave.js)  (prembly.js)    (mailer.js)   (assistant)
```

Outside the API: **Smartsupp** live chat is loaded straight into buyer and vendor pages; **Google Identity Services** is loaded by `google-signin.js`, and the token it returns is verified by the API (`utils/googleAuth.js`).

**Deploying.** A push to `main` is picked up by `deploy/cpanel-autodeploy.sh` (a cPanel cron job), which runs cPanel's Git deployment, which runs `.cpanel.yml`: the website is copied into `~/vetrahq.org`, the backend into `~/vetra-api`, dependencies are installed, `npm run migrate` applies new migrations, and Passenger restarts the API. Details: `backend/README.md`.

**The scheduled sweep.** Every 10 minutes something has to release escrow, expire rider offers, retry payouts and give back stock from unpaid checkouts. `utils/scheduledJobs.js` runs it. The real runner is a cPanel cron job running `scripts/delivery-cron.js`; the API also runs it from its own timer (`server.js`) as a backup while the site has traffic, and `POST /api/delivery/cron` can trigger it. Each run records a heartbeat in `job_runs`; `GET /api/health/jobs` returns 503 when it has stopped.

---

## 3. Conventions

- **No build step, no framework.** Plain HTML, CSS and `<script>` tags. What is in the repository is exactly what is served.
- **Shared files live at the project root** and every app reaches them with `../`: `api-client.js`, `shared-ui.js`, `theme.js`, `pwa.js`, `password-toggle.js`, `notifications-ui.js`, `support.js`, `vetra-tokens.css`, `surface.css`, `notifications.css`. Each app keeps only what is specific to it in its own `assets/`.
- **Stylesheet order on every page:** `vetra-tokens.css` (colours, type, spacing, light and dark) → the area's own stylesheet → `surface.css` last (keeps every area flat and minimal). **Never write a hex colour** in a stylesheet, inline style or script; use a token, or Dark Mode breaks.
- **Script order on an app page:** `theme.js` and `pwa.js` in the `<head>`, then `api-client.js` → data helpers → `shared-ui.js` → the app's `interactions.js` / `ui.js` → the page's own script(s) → `../support.js`.
- **The app shell.** Every signed-in page (buyer, vendor, admin) has the same skeleton: a collapsible sidebar on desktop (≥900px), a tab bar on mobile, a top bar, and `<main class="page-shell">`. The markup is written into each page; `interactions.js` (buyer, vendor) or `ui.js` (admin) wires the behaviour through `VetraChrome` in `shared-ui.js`.
- **Money is kobo** (integer) everywhere in data. Only `api-client.js`'s `formatNaira()` / `nairaToKobo()` convert, at display time.
- **Order status** is stored with underscores (`out_for_delivery`); CSS classes and filter tabs use hyphens. `orderStatusSlug()` in `api-client.js` is the one conversion.
- **Escaping.** Anything user-typed that goes into `innerHTML` is escaped: server-side at write time (`backend/src/utils/escapeHtml.js`) and in the browser with `VetraAPI.escapeHtml()`.
- **Adding a page:** copy the `<head>`, sidebar, top bar and tab bar from its closest sibling. A new public page also goes into `sitemap.xml`; a new signed-in area goes into `robots.txt`'s `Disallow` list.

---

## 4. Every file

Each table lists what a file does and what it connects to. "Loaded by" means the pages that include it with a `<script>` or `<link>` tag.

### 4.1 Project root: configuration and deployment

| File | What it does | Connects to |
|---|---|---|
| `.cpanel.yml` | cPanel's deployment recipe. Copies the website (everything except `backend/`, docs, PDFs and tooling) into `~/vetrahq.org` without touching `uploads/`; copies `backend/` into `~/vetra-api`, runs `npm install` and `npm run migrate`, moves old uploads onto the server, restarts Passenger. | Run by cPanel's "Deploy HEAD Commit", which `deploy/cpanel-autodeploy.sh` triggers. Runs `backend/scripts/migrate.js` and `move-uploads-to-cpanel.js`. |
| `deploy/cpanel-autodeploy.sh` | Cron script: fetches GitHub, and when `main` has a new commit, moves cPanel's Git clone to it and runs the deployment. | A cPanel cron job every 5 minutes (`backend/README.md`, "Deploying changes afterwards"). Triggers `.cpanel.yml`. |
| `.htaccess` | Apache rules for `vetrahq.org`: HTTPS and one hostname, no directory listings, blocks dotfiles and `.md/.pdf/.sql/.sh/.yml/.zip`, security headers, cache rules, the manifest MIME type. | Applies to every file the site serves. Leaves `uploads/` and `.well-known/` reachable. |
| `.gitignore` | Keeps `.env*` files and the two zips built by `package-cpanel.sh` out of Git. | `backend/.gitignore` covers the backend. |
| `robots.txt` | Lets search engines in, keeps them out of `admin/`, `rider/`, `vendor/`, the buyer's private pages and `reset-password.html`. Points to both sitemaps. | `sitemap.xml`; the API's `/sitemap.xml` (`backend/src/routes/sitemap.routes.js`). |
| `sitemap.xml` | The public and guest-browsable pages, for search engines. Hand-maintained: add new public pages here. | Listed in `robots.txt`. Products and stores are in the API's live sitemap instead. |
| `manifest.webmanifest` | The installable "VETRA" app for buyers and vendors. Opens `app.html`. | Linked from buyer, vendor and auth pages; icons in `assets/brand/app/`; made installable by `pwa.js` + `sw.js`. |
| `favicon.ico` | Browser tab icon. Browsers ask for `/favicon.ico` on their own, so nothing links it. | `assets/brand/favicon-*.png` are the linked versions. |
| `.claude/settings.json` | Claude Code tool permissions for this project. Not part of the site; excluded from deploys. | — |
| `.vscode/settings.json` | Editor setting (`python.terminal.useEnvFile`). Not part of the site. | — |

### 4.2 Project root: public pages

| File | What it does | Loads / calls |
|---|---|---|
| `index.html` | Home page: hero, categories, "Popular this week" (real products), how buyer and vendor protection work, footer. | `script.js` (nav, real products via `GET /products`, footer links), `api-client.js`, `pwa.js`. |
| `about.html` | Why VETRA exists and how it works. Static. | `script.js`. Shows `customer/assets/images/cat-appliances.jpg` and `cat-health.jpg`. |
| `contact.html` | Contact form (buyer or vendor), FAQ. Messages go to the admin console's Messages page and the sender gets a confirmation email. | `script.js` → `POST /api/contact` (`contact.routes.js`) → `admin/messages.html`. |
| `buyer-protection.html` | The buyer's escrow, dispute and refund policy. Static. | `script.js`. |
| `vendor-protection.html` | The vendor's side: verification, disputes, payouts. Static. | `script.js`. |
| `commission-and-fees.html` | VETRA's commission and Flutterwave's fees, with the live commission rate. | Inline script → `GET /api/payments/commission`. Linked from `vendor/assets/fee-hint.js`. |
| `terms.html` | Terms and conditions. Static. | `script.js`. |
| `track.html` | Public order tracking by tracking ID (`VTA-…`): status, timeline, and the rider's live position while out for delivery. Order emails link here with `?code=`. | `track.js` → `GET /api/delivery/track/:code`. |
| `signin.html` | Buyer / Vendor sign-in (tabbed), Google sign-in, "Continue as guest", 2FA code step, link to the rider app. | `signin.js`, `google-signin.js`, `password-toggle.js`, `signup.css`. |
| `signup.html` | Buyer / Vendor account creation (`#Vendor` opens the vendor tab). | `signup.js`, `google-signin.js`, `password-toggle.js`, `signup.css`. |
| `forgot-password.html` | Asks for an email and sends a reset link. | Inline script → `POST /api/auth/forgot-password`. |
| `reset-password.html` | Sets a new password from an emailed link (`?token=`). Also how a new rider or admin-reset account sets its first password. | Inline script → `POST /api/auth/reset-password`; links are emailed by `backend/src/utils/passwordReset.js`. |
| `app.html` | Start page of the installed VETRA app. Opens the buyer or vendor dashboard you were last signed in to, or `signin.html`. `noindex`. | Reads the role tokens `api-client.js` stores. Opened by `manifest.webmanifest`. |
| `offline.html` | Shown by the service worker when a page isn't cached and there's no connection. `noindex`. | Served by `sw.js`. |

### 4.3 Project root: shared scripts and styles

| File | What it does | Used by |
|---|---|---|
| `api-client.js` | `VetraAPI`: every call to the backend. Holds `VETRA_API_BASE` (`https://api.vetrahq.org/api`), one token per role (`vetra_buyer_token`, `vetra_vendor_token`, `vetra_rider_token`, `vetra_admin_token`), uploads, a per-browser device ID (`X-Device-Id`, used for device bans), `escapeHtml()`, naira/kobo helpers, order-status labels. | Every page that talks to the API: public, buyer, vendor, rider, admin. |
| `shared-ui.js` | `VetraModal` (`confirm`, `info`, `photoPreview`, mounts its own markup) and `VetraChrome` (sidebar toggle and collapse, avatars). One implementation for every app. | Wrapped by `customer/assets/ui.js`, `vendor/assets/ui.js`, `admin/assets/ui.js`; used directly by `rider/assets/rider.js`. |
| `theme.js` | Light / Dark. Applies the saved choice (`vetra_theme`) before first paint, adds the header button. | Every page's `<head>`. Works with `vetra-tokens.css`'s `data-theme`. |
| `pwa.js` | Registers `sw.js` and shows the "Install the app" bar (or an iPhone tip). | Buyer, vendor, rider and auth pages, `index.html`. |
| `sw.js` | Service worker. Pages and scripts network-first (offline falls back to the last copy, then `offline.html`); images cache-first; never touches API calls. Bump `VERSION` when its rules change. | Registered by `pwa.js` from the site root. |
| `password-toggle.js` | Adds a show/hide eye button to every password field. | `signin.html`, `signup.html`, `reset-password.html`, `admin/login.html`, `rider/login.html`, `rider/signup.html`, `customer/settings.html`. |
| `google-signin.js` | "Continue with Google" popup (Google's OAuth token client), then asks for phone, address and state if Google didn't supply them. | `signin.html`, `signup.html` → `POST /api/auth/google` (`backend/src/utils/googleAuth.js`). |
| `notifications-ui.js` | The notifications list: groups, read/unread look, mark read, mark all read. | `customer/assets/notifications.js`, `vendor/assets/notifications.js` → `/api/notifications`. Styled by `notifications.css`. |
| `support.js` | Opens Smartsupp live chat from any `.support-btn` (sidebar, tab bar, header icon) and adds its own close button. One copy for both apps. | Every buyer and vendor page. Styled by each app's `assets/style.css` (`body.livechat-open`). |
| `script.js` | Public site: mobile nav, FAQ accordion, contact form, home page "Popular this week", and the footer's social links. | Public pages. Calls `GET /products`, `POST /contact`, `GET /social-links` (edited in `admin/assets/social-links.js`). |
| `signin.js` | Sign-in page: Buyer/Vendor tabs, `#Vendor` deep link, the 2FA step, redirect to the right dashboard. | `signin.html` → `POST /api/auth/signin`, `/auth/2fa/*`. |
| `signup.js` | Sign-up page: Buyer/Vendor tabs, the state dropdown, account creation, redirect to sign-in. | `signup.html` → `POST /api/auth/signup`. |
| `track.js` | Public tracking lookup and live rider position. | `track.html`. |
| `vetra-tokens.css` | The design tokens: system font, type scale, spacing, radii, every colour as a light/dark token. Loaded first everywhere. | Every page. |
| `surface.css` | Last-loaded layer that keeps every area flat: neutral backgrounds, hairline borders, one accent, no gradients. Also `--cat-tile` for the category drawings. | Every page. |
| `style.css` | Public site stylesheet (also the base for the auth pages). | Public pages, auth pages, `admin/login.html`. |
| `signup.css` | Sign-in / sign-up / password-reset layout. | `signin.html`, `signup.html`, `forgot-password.html`, `reset-password.html`, `admin/login.html`. |
| `notifications.css` | Notification card styles. Loaded after the app's own stylesheet so it wins. | `customer/notifications.html`, `vendor/notifications.html`. |

### 4.4 `assets/`: shared images

| File | What it is | Used by |
|---|---|---|
| `assets/brand/logo-full.png` | The VETRA logo (for light backgrounds). | Headers of every area. |
| `assets/brand/logo-full-white.png` | The white logo, swapped in by `<picture>` in Dark Mode. | Same. |
| `assets/brand/favicon-32.png`, `favicon-192.png` | Browser tab icons. | Every page's `<head>`. |
| `assets/brand/apple-touch-icon.png` | iPhone/iPad home-screen icon. | Every page's `<head>`. |
| `assets/brand/app/icon-192.png`, `icon-512.png` | Installed-app icons. | `manifest.webmanifest`, `rider/manifest.webmanifest`. |
| `assets/brand/app/icon-maskable-192.png`, `icon-maskable-512.png` | Android adaptive (maskable) versions of the same. | Both manifests. |
| `assets/avatar-placeholder.svg` | Default profile picture until an account uploads its own. One copy for every app. | Buyer, vendor and admin headers, settings and lists (`../assets/avatar-placeholder.svg`). |
| `assets/product-placeholder.svg` | Shown when a product has no photo; dimmed in Dark Mode by `surface.css`. | Product cards, product page, cart and orders (buyer), vendor product grid and orders, the home page's "Popular this week". |
| `assets/banners/banner-1.jpg`, `banner-2.jpg` | Fallback promo banners when an admin hasn't uploaded any; also in `about.html`'s photo mosaic. | `customer/dashboard.html`, `customer/explore.html` (inline banner script), `about.html`. |

### 4.5 `customer/`: the buyer app

Guests can browse, view products and fill a cart; orders, settings and checkout need a buyer account.

**Pages**

| File | What it does | Loads (besides the shared files) |
|---|---|---|
| `dashboard.html` | Home: admin-managed banner carousel, category rail, featured products. | `products.js`, `product-grid.js`, `badges.js`, `cart-store.js`, `category-art.js`, `interactions.js`. Inline script: `GET /site-banners`. |
| `explore.html` | Browse and search all products, category chips, filter panel, top vendors. Reads `?q=` and `?cat=`. | `products.js`, `product-grid.js`, `badges.js`, `cart-store.js`, `vendors.js`, `filters.js`. |
| `category.html` | Redirect only, to `explore.html` (keeps old `?cat=` links working). | — |
| `product.html` | One product (`?id=`): photos, video, price, stock, "Sold by", add to cart, reviews. | `products.js`, `cart-store.js`, `reviews.js`. Inline: reviews and purchase check. |
| `store.html` | One vendor's storefront (`?vendor=`): profile, products, reviews. | `products.js`, `product-grid.js`, `badges.js`, `cart-store.js`, `vendors.js`, `reviews.js`. |
| `vendors.html` | Directory of every vendor with search. | `vendors.js`. |
| `cart.html` | Cart and saved-for-later, delivery details and fees per store, checkout through Flutterwave. | `products.js`, `cart-store.js`, `cart.js`. |
| `orders.html` | Order history, delivery tracking panel (codes, rider, live map, timeline), "I received it", file a report. Return page after payment (`?payment=`). | `orders.js`, `report-issue.js`. |
| `notifications.html` | The buyer's notifications. | `notifications-ui.js`, `notifications.js`. |
| `settings.html` | Profile, photo, password, notification preferences, help, deactivate. | `password-toggle.js`. Inline: `/auth/me`, `/auth/password`, `/auth/deactivate`. |

**`customer/assets/`**

| File | What it does | Connects to |
|---|---|---|
| `style.css` | The buyer app stylesheet (shell, product grid, cart, orders…). The vendor and admin shells match it. | Every buyer page. |
| `interactions.js` | `Vetra`: sidebar toggle/collapse, banner carousel, product cards → `product.html`, Add to Cart, header cart and notification badges. | Every buyer page. Uses `cart-store.js`, `shared-ui.js`. |
| `ui.js` | `CustomerUI`: thin wrapper over `VetraModal`. | `shared-ui.js`. |
| `products.js` | `VetraCatalog`: cache of products from `GET /api/products`, `getProduct(id)`, and the "New"/"Hot" badge rule. | `product-grid.js`, `badges.js`, `cart-store.js`, `cart.js`. |
| `product-grid.js` | Builds product cards from catalogue rows (same markup on dashboard, explore, store). | `products.js`; feeds `filters.js` and `badges.js`. |
| `badges.js` | Puts the "New"/"Hot" badge on product cards. | `products.js`. |
| `filters.js` | The filter panel next to a search bar: category, price, sort. | `explore.html`. Reads `data-*` set by `product-grid.js`. |
| `category-art.js` | `VetraCategoryArt`: a flat SVG drawing for each category. | `dashboard.html`'s category rail. Tile colour from `surface.css`. |
| `vendors.js` | `VetraVendorDirectory`: cache of vendors from `GET /api/vendors`. | `explore.html`, `store.html`, `vendors.html`. |
| `cart-store.js` | `CartStore` and `SavedForLaterStore`: `{id, qty}` lists in `localStorage`; names and prices are always looked up live. | `interactions.js`, `cart.js`, `index.html`'s "Buy now" (`script.js`). |
| `cart.js` | The cart page: quantities, save for later, per-store delivery quotes, checkout. | `GET /delivery/quote`, `POST /payments/checkout` (`backend/src/utils/payments.js`) → Flutterwave → back to `orders.html?payment=`. |
| `orders.js` | Order list, status tabs, delivery panel (refreshes every 30 s), confirm receipt, the payment result after checkout. | `GET /orders/mine`, `GET /delivery/orders/:id`, `POST /delivery/orders/:id/confirm`, `GET /payments/:reference`. |
| `report-issue.js` | "Report an issue" modal on an order. | `POST /api/reports` → `admin/reports.html`, `vendor/assets/reports.js`. |
| `reviews.js` | `CustomerReviews`: review summary and list rendering. | `product.html`, `store.html` → `/api/vendors/:id/reviews`. |
| `notifications.js` | Starts `notifications-ui.js` for the buyer role. | `notifications.html`. |
| `images/cat-appliances.jpg`, `cat-health.jpg` | Category photos. | `about.html`. |

### 4.6 `vendor/`: the seller app

**Pages**

| File | What it does | Loads (besides the shared files) |
|---|---|---|
| `dashboard.html` | Stats, recent orders, a preview of the product grid, Add Product. | `products-data.js`, `add-product.js`, `fee-hint.js`, `product-actions.js`, `dashboard.js`. |
| `products.html` | Every listing, category tabs, an Out of Stock section, add/edit/remove. | `products-data.js`, `add-product.js`, `fee-hint.js`, `product-actions.js`. |
| `orders.html` | Orders with status tabs, delivery actions (ready for pickup, pickup code, ship it myself, returns), reports against the store. | `orders.js`, `order-tracking.js`, `reports.js`. |
| `earnings.html` | Sales, paid out, pending payout, commission; the payout bank account. | `earnings.js`, `payout.js`. |
| `profile.html` | Store details, photos, password, 2FA, business verification (KYC), deactivate/delete. | `profile.js`, `kyc.js`. |
| `notifications.html` | The vendor's notifications. | `notifications-ui.js`, `notifications.js`. |

**`vendor/assets/`**

| File | What it does | Connects to |
|---|---|---|
| `style.css` | The vendor app stylesheet. Also loaded by the rider app for modal styles. | Every vendor page, `rider/`. |
| `interactions.js` | `VetraUI`: vendor session check (`requireVendorSession`), sidebar, notification badge. | Every vendor page. `shared-ui.js`. |
| `ui.js` | `VendorUI`: thin wrapper over `VetraModal`. | `shared-ui.js`. |
| `products-data.js` | `VetraVendorProducts`: the vendor's products from `GET /products?vendor=`, renders the grid, keeps a lookup by id. | `add-product.js`, `product-actions.js`. |
| `add-product.js` | `VetraAddProduct`: the add/edit modal; uploads photos and video first, then creates or updates the product. | `POST /uploads`, `POST`/`PATCH /products`; `products-data.js` reloads the grid. |
| `product-actions.js` | Edit / Remove on each card, the Add Product shortcut. | `add-product.js`, `products-data.js`, `DELETE /products/:id`. |
| `fee-hint.js` | Under the price field: what the vendor receives after commission. | `GET /payments/commission`; links to `commission-and-fees.html`. |
| `dashboard.js` | Dashboard stats and recent orders, worked out from the order and product lists. | `GET /orders/vendor`, `GET /products?vendor=`. |
| `orders.js` | Orders list, status tabs, delivery actions, marking an item unavailable. | `GET /orders/vendor`, `/delivery/orders/:id/ready`, `/self-ship`, `/pickup-complete`, `/return-received` (`backend/src/utils/delivery.js`), `/orders/:id/items/:itemId/unavailable`. |
| `order-tracking.js` | "Update shipment" modal for orders the vendor ships without a VETRA rider. | `PATCH /orders/:id/shipment`. |
| `reports.js` | Reports against the store, and submitting evidence. | `GET /reports/mine`, `POST /reports/:id/evidence`; decided in `admin/reports.html`. |
| `earnings.js` | The four earnings figures and payout history. | `GET /vendors/me/earnings`. |
| `payout.js` | Payout bank account: searchable bank list, account name looked up from the bank. | `/vendors/me/payout-account` (`backend/src/utils/payoutAccount.js` → Flutterwave). |
| `profile.js` | Store details, avatar and cover photo, password, 2FA, deactivate, delete, sign out. | `/auth/me`, `/uploads`, `/auth/password`, `/auth/deactivate`, `/auth/delete-account`. |
| `kyc.js` | Business verification: upload ID and CAC documents, then run the identity and CAC checks. | `POST /uploads` (private), `/vendors/me/kyc`, `/me/kyc/verify` (`prembly.js`); reviewed in `admin/vendor-detail.html`. |
| `notifications.js` | Starts `notifications-ui.js` for the vendor role. | `notifications.html`. |

### 4.7 `rider/`: the rider app

| File | What it does | Connects to |
|---|---|---|
| `index.html` | The whole rider app in one page: Jobs, History, Bank, duty switch, delivery area. | `rider.js`, `rider.css`, `shared-ui.js`. |
| `login.html` | Rider sign-in. | Inline → `POST /api/auth/signin` (rider role). |
| `signup.html` | Become a rider: account, then an identity check (NIN, driver's licence or voter's card) before the account goes active. | Inline → `POST /api/auth/signup`, `POST /api/delivery/rider/identity` (`prembly.js`). |
| `manifest.webmanifest` | The installable "VETRA Rider" app, scoped to `rider/`. | `pwa.js`, `sw.js`, `assets/brand/app/` icons. |
| `assets/rider.js` | Everything on a job: accept/decline, pickup code, start delivery, buyer's code and photo, failed delivery, returns; sends position every 30 s while on a job; polls for offers every 20 s; payout account. | `/api/delivery/rider/*` (`backend/src/routes/delivery.routes.js`). |
| `assets/rider.css` | Phone-first rider layout with large tap targets. | `rider/` pages. |

Full lifecycle: `DELIVERY_SYSTEM.md`.

### 4.8 `admin/`: the staff console

Every page except `login.html` loads `session.js` (redirects to login without an admin session, and hides what the admin's role can't do). The server enforces roles regardless.

**Pages**

| File | What it does | Script |
|---|---|---|
| `login.html` | Admin sign-in, with the 2FA step. | Inline → `POST /api/auth/admin-signin`. |
| `dashboard.html` | Platform stats, recent activity, pending vendor applications, sweep health, Flutterwave balance (Super Admin). | `assets/dashboard.js` |
| `customers.html` | Every buyer: search, status filter, suspend/reactivate. | `assets/customers.js` |
| `customer-detail.html` | One buyer (`?id=`): profile, orders, reports, activity, login IPs, devices, ban, contact changes, password reset. | `assets/customer-detail.js`, `assets/contact-change.js` |
| `vendors.html` | Every vendor: status tabs, approve/reject, suspend. | `assets/vendors.js` |
| `vendor-detail.html` | One vendor (`?id=`): store, KYC review, payout account history, orders, reports, activity, ban. | `assets/vendor-detail.js`, `assets/contact-change.js` |
| `reports.html` | Reports and disputes queue: resolve, dismiss, suspend the store. | `assets/reports.js` |
| `deliveries.html` | Dispatch, riders, delivery rates and switches. | `assets/deliveries.js` |
| `payments.html` | Payouts, payments in, refunds, commission and auto-payouts (Super Admin only). | `assets/payments.js` |
| `messages.html` | Contact-form messages: read, reply by email, close/reopen. | `assets/messages.js` |
| `activity.html` | The audit log, filterable; Super Admins can prune it. | `assets/activity.js` |
| `settings.html` | Own profile, site banners, social media links, admin team and invites, platform switches. | `assets/settings.js`, `assets/social-links.js` |

**`admin/assets/`**

| File | What it does | Connects to |
|---|---|---|
| `style.css` | Admin stylesheet; same shell as the buyer and vendor apps. | Every admin page. |
| `session.js` | `AdminSession`: requires an admin token, returns the signed-in admin, `canModerate()` / `isSuperAdmin()` for hiding buttons. | Every admin page except `login.html`. |
| `ui.js` | `AdminUI`: wraps `VetraModal` / `VetraChrome`, plus the activity feed and login-IP renderers. | `shared-ui.js`, `format-helpers.js`. |
| `format-helpers.js` | `VetraAdmin`: initials, avatar markup, date, date-time, relative date, "time ago". | Most admin scripts. |
| `dashboard.js` | Dashboard figures. | `GET /admin/stats`, `/admin/activity`, `/admin/vendors?status=pending`, `/admin/balance`. |
| `customers.js` / `vendors.js` | The two account lists. | `/admin/customers`, `/admin/vendors`. |
| `customer-detail.js` / `vendor-detail.js` | The two detail pages, including KYC review on the vendor side. | `/admin/customers/:id`, `/admin/vendors/:id`, `/reports`, `/admin/activity`. |
| `contact-change.js` | Changing another user's email (two-step code) or phone, and a vendor's legal name. Builds its own modal. | The email, phone and legal-name routes under `/admin/customers/:id` and `/admin/vendors/:id`. |
| `reports.js` | Moderation queue. | `/reports`, `PATCH /admin/vendors/:id/status`. |
| `deliveries.js` | Dispatch console, rider management, rates. | `/api/delivery/admin/*`. |
| `payments.js` | Money screens. | `/admin/payments`, `/payouts`, `/refunds`, `/balance`. |
| `messages.js` | Contact messages. | `/admin/messages`. |
| `activity.js` | Activity log page. | `/admin/activity`. |
| `settings.js` | Profile, banners, team, invites, platform switches. | `/auth/me`, `/uploads`, `/site-banners`, `/admin/team`, `/admin/invites`, `/admin/settings`. |
| `social-links.js` | The Social Media card: edit, add, remove, reorder, save. | `GET`/`PUT /social-links` → shown in the public footer by `script.js`. |

### 4.9 `backend/`: the API

**Setup and configuration**

| File | What it does |
|---|---|
| `package.json` | Dependencies (Express, mysql2, bcryptjs, jsonwebtoken, multer, nodemailer, express-rate-limit, cors, dotenv, the Anthropic SDK) and the scripts: `start`, `dev`, `migrate`, `cron`, `copy-data`, `package:cpanel`. |
| `package-lock.json` | Exact dependency versions, so the server installs what was tested. |
| `.env.example` | Every environment variable with a placeholder. Copy to `.env` (never committed). Explained in `backend/README.md`. |
| `.gitignore` | Keeps `node_modules/`, `.env` and logs out of Git. |
| `README.md` | Local setup, environment variables, cPanel setup and deployment, troubleshooting. |

**`src/`: the app**

| File | What it does | Connects to |
|---|---|---|
| `server.js` | Loads `.env`, starts the app on Passenger's port, checks the mail connection, starts the backup sweep timer. | `app.js`, `utils/mailer.js`, `utils/scheduledJobs.js`. |
| `app.js` | Builds the Express app: CORS, the Flutterwave webhook (before JSON parsing), JSON parsing, device bans, `/api/health`, `/api/health/jobs`, `/uploads`, every route module, `/sitemap.xml`, 404, error handler. | Every file in `middleware/` and `routes/`. |
| `db.js` | The MySQL connection pool, shared by every route and util. | Everything that queries. |

**`src/middleware/`**

| File | What it does |
|---|---|
| `auth.js` | `requireAuth` (checks the token, then re-reads the user row: still active, session not revoked, not idle), `optionalAuth`, `requireRole`, `requireAdminRole`. |
| `rateLimit.js` | Fourteen limits (per IP, except KYC checks, which are per vendor): sign-in, admin sign-in, Google, sign-up, forgot and reset password, both 2FA steps, uploads, public delivery lookups, delivery codes, KYC checks, the contact form, the assistant. |
| `deviceBan.js` | Refuses every request from a banned device (except the admin console and contact form). Uses `utils/devices.js`. |
| `errorHandler.js` | Last middleware: turns errors into `{ error }` JSON, never a stack trace. |

**`src/routes/`** (full endpoint list: `BACKEND_GUIDE.md` §5)

| File | Mounted at | Serves |
|---|---|---|
| `auth.routes.js` | `/api/auth` | Sign-up, sign-in (buyer, vendor, rider), admin sign-in, Google, 2FA, own profile, password, forgot/reset, deactivate, delete. |
| `products.routes.js` | `/api/products` | Public browse/search/detail; vendor create, edit, remove; auto-flagging; low-stock alerts. |
| `vendors.routes.js` | `/api/vendors` | Vendor directory and storefront; the vendor's KYC, earnings and payout account. |
| `reviews.routes.js` | `/api/vendors/:vendorId/reviews` | Store reviews, only from a buyer with a completed order. |
| `orders.routes.js` | `/api/orders` | Buyer order history, vendor order list, shipment updates, unavailable items. (Orders are created by `utils/payments.js`.) |
| `payments.routes.js` | `/api/payments` | Checkout, payment status, commission rate, the Flutterwave webhook. |
| `delivery.routes.js` | `/api/delivery` | Fee quotes, public tracking, buyer/vendor/rider delivery actions, rider signup identity, admin dispatch, the cron trigger. |
| `reports.routes.js` | `/api/reports` | Buyers file reports, vendors respond, admins decide. |
| `notifications.routes.js` | `/api/notifications` | The signed-in user's notifications. |
| `uploads.routes.js` | `/api/uploads` | File uploads (public, or private for KYC with signed links). |
| `site-banners.routes.js` | `/api/site-banners` | Promo banners: public read, Super Admin edit. |
| `social-links.routes.js` | `/api/social-links` | Footer social links: public read, Super Admin replace. |
| `contact.routes.js` | `/api/contact` | The public contact form. |
| `admin.routes.js` | `/api/admin` | Everything in the admin console except deliveries: accounts, bans, KYC review, stats, activity, team, invites, settings, payments, messages. |
| `assistant.routes.js` | `/api/assistant` | AI shopping assistant (Anthropic). Works, but no page calls it yet. |
| `sitemap.routes.js` | `/sitemap.xml` | Live sitemap of every visible product and store, for search engines. Listed in `robots.txt`. |

**`src/utils/`**

| File | What it does | Used by |
|---|---|---|
| `asyncHandler.js` | Sends a failed async route to the error handler. | Every route file. |
| `id.js` | UUIDv7 ids (time-ordered), tracking codes, and the `VTA-` / `VTR-` reference format. | Everything that inserts. |
| `jwt.js` | Signs and verifies session tokens. | `auth.routes.js`, `middleware/auth.js`. |
| `password.js` | bcrypt hashing and checking. | `auth.routes.js`, `admin.routes.js`, `delivery.routes.js`. |
| `passwordReset.js` | Creates a one-time reset token and emails the link to `reset-password.html`. | `auth.routes.js`, `admin.routes.js`, `delivery.routes.js` (rider invites). |
| `googleAuth.js` | Verifies a Google access token belongs to this app and reads the user's profile. | `auth.routes.js`. |
| `encryption.js` | AES-256-GCM for secrets read back later (bank account numbers, identity numbers), and the key behind `identifiers.js`'s hashes. | `payoutAccount.js`, `identifiers.js`, `payments.js`, `vendors.routes.js`, `admin.routes.js`, `delivery.routes.js`. |
| `identifiers.js` | Records a hashed fingerprint of each account's email, phone, device, ID numbers, bank account and card; finds linked accounts. | `bans.js`, sign-up, KYC, payout, checkout. |
| `bans.js` | Permanent bans: bans the person (every identifier), signs them out, delists products; lifting a ban reverses it. | `admin.routes.js`, sign-up/KYC/payout/checkout checks. |
| `devices.js` | Records which devices each account uses; the in-memory banned-device list. | `middleware/deviceBan.js`, `auth.routes.js`, `admin.routes.js`. |
| `nigerianStates.js` | The 36 states plus FCT, for validating `state`. | `auth.routes.js`, `delivery.js`. |
| `safeUrl.js` | Only accepts file links on VETRA's own upload URL, so a stored link can't inject script. | Products, profiles, banners, reports, delivery photos. |
| `escapeHtml.js` | Escapes user text at write time for fields shown with `innerHTML`. | `activityLog.js`, `notify.js`, several routes. |
| `storage.js` | Saves uploads to disk: public files into `~/vetrahq.org/uploads`, KYC documents outside the website with signed links. | `uploads.routes.js`, `scripts/move-uploads-to-cpanel.js`. |
| `mailer.js` | Sends every email through cPanel SMTP (nodemailer). | Every util and route that emails. |
| `orderEmail.js` | The itemised order email body. | `orders.routes.js`, `delivery.js`, `payments.js`. |
| `accountEmail.js` | "Your account was deleted" email. | `admin.routes.js`, `auth.routes.js`. |
| `notify.js` | Writes an in-app notification. | Routes and utils at each state change. |
| `activityLog.js` | Writes an audit-log row. | Every mutating admin, vendor and system action. |
| `lowStockAlert.js` | Notifies and emails a vendor when a product drops to the low-stock threshold. | `products.routes.js`, `payments.js`. |
| `orderItemsSubquery.js` | The SQL that attaches each order's items to an order list. | `orders.routes.js`, `admin.routes.js`. |
| `flutterwave.js` | Flutterwave API client: checkout links, verifying payments, transfers, refunds, banks, account lookup, balance. Converts kobo ↔ naira. | `payments.js`, `payoutAccount.js`, `admin.routes.js`. |
| `payments.js` | Money: checkout (prices the cart, reserves stock), creating orders once paid, payouts, refunds, the payments sweep. | `payments.routes.js`, `delivery.js`, `admin.routes.js`, `scheduledJobs.js`. `PAYMENTS.md`. |
| `payoutAccount.js` | Router for a user's own payout bank account (bank list, name lookup, save). | Mounted under `vendors.routes.js` and `delivery.routes.js`. |
| `prembly.js` | Identity checks: NIN, BVN, driver's licence, voter's card, CAC. | `vendors.routes.js` (KYC), `delivery.routes.js` (rider signup). |
| `delivery.js` | The delivery state machine, fee quotes, rider assignment, escrow release, the delivery sweep. | `delivery.routes.js`, `orders.routes.js`, `payments.js`, `scheduledJobs.js`. `DELIVERY_SYSTEM.md`. |
| `scheduledJobs.js` | Runs the delivery and payments sweeps, records the heartbeat in `job_runs`, emails Super Admins when it keeps failing, and the API's backup timer. | `server.js`, `scripts/delivery-cron.js`, `delivery.routes.js`, `app.js` (`/api/health/jobs`). |

**`scripts/`**

| File | What it does | When |
|---|---|---|
| `migrate.js` | Applies every migration in `migrations/` not yet recorded in `schema_migrations`, in filename order. | Every deploy (`.cpanel.yml`), and `npm run migrate`. |
| `delivery-cron.js` | Runs the scheduled sweep once and exits. | Every 10 minutes from a cPanel cron job (`backend/README.md`, step 9). This is the main runner. |
| `move-uploads-to-cpanel.js` | Finds file links still pointing at Cloudinary or Google and moves those files onto the server. Does nothing once everything has moved. | Every deploy. |
| `copy-data.js` | One-time copy of every row from an old database into a new one. | Only when moving databases (`backend/README.md`, step 8). |
| `backfill-identifiers.js` | One-time: records identifiers for accounts made before ban tracking (`--cards` also fetches card fingerprints). | Once, by hand. |
| `package-cpanel.sh` | Builds `vetra-api-cpanel.zip` and `vetrahq-site.zip` for uploading by File Manager instead of Git. | By hand (`npm run package:cpanel`). |

**`migrations/`** run in order; each one only adds to the schema. Table-by-table explanations are in `BACKEND_GUIDE.md` §3.

| File | Adds |
|---|---|
| `001_init.sql` | The original schema: users, products, orders, order items, reviews, reports, evidence, activity log, KYC, banners, invites, notifications, reset tokens, platform settings. |
| `002_feature_updates.sql` | Vendor, order and KYC feature columns. |
| `003_order_item_availability.sql` | Per-item "unavailable" status for partial fulfilment. |
| `004_two_factor_auth.sql` | Email sign-in codes (`two_factor_codes`). |
| `005_payout_bank_code.sql` | The bank code on payout accounts. |
| `006_tracking_code_dash.sql` | The dashed `VTA-` / `VTR-` reference format. |
| `007_session_activity.sql` | `last_activity_at`, for idle sign-out. |
| `008_auth_revocation.sql` | `session_version`, for signing out everywhere. |
| `009_low_stock_notifications.sql` | Low-stock alert tracking. |
| `010_admin_audit_details.sql` | Login IP history and payout-account history for audits. |
| `011_checkid_identity_verification.sql` | Encrypted identity-number columns for KYC (first provider). |
| `012_vendor_identity_names.sql` | Vendor legal name parts, for matching against ID records. |
| `013_kyc_manual_review.sql` | The `manual_review` KYC status. |
| `014_pending_contact_changes.sql` | Admin-started email changes with a code. |
| `015_delivery_system.sql` | Riders, delivery rates, deliveries, delivery events. |
| `016_idcheck_identity_types.sql` | BVN as an identity type. |
| `017_payments.sql` | Payments, payouts, refunds. |
| `018_contact_messages.sql` | Contact-form messages. |
| `019_job_runs.sql` | The sweep heartbeat. |
| `020_lowercase_emails.sql` | Lowercases existing emails. |
| `021_device_bans.sql` | `user_devices`, `banned_devices`. |
| `022_permanent_bans.sql` | `user_identifiers`, `user_bans`, `banned_identifiers`, the `banned` status, card fingerprints. |
| `023_payout_cancel.sql` | Cancelling a payout. |
| `024_admin_password_reset_codes.sql` | Codes for a Super Admin helping a locked-out admin. |
| `025_refund_cancel.sql` | Cancelling a failed refund. |
| `026_rider_signup_identity.sql` | Rider self-signup with an identity check. |
| `027_vendor_voters_card.sql` | Voter's card as a vendor identity type. |
| `028_flutterwave.sql` | The move from Paystack to Flutterwave (`provider` on every payment and payout). |
| `029_social_links.sql` | `social_links`. |

### 4.10 Guides

| File | |
|---|---|
| `DOCUMENTATION.md`, `DOCUMENTATION.pdf` | This file. |
| `BACKEND_GUIDE.md`, `BACKEND_GUIDE.pdf` | API, data model, security. |
| `ADMIN_GUIDE.md`, `ADMIN_GUIDE.pdf` | Running the live site. |
| `DELIVERY_SYSTEM.md`, `DELIVERY_SYSTEM.pdf` | Delivery. |
| `PAYMENTS.md`, `PAYMENTS.pdf` | Money. |
| `backend/README.md` | Running and deploying the API. |

---

## 5. How the main flows move through the files

**Signing in.** `signin.html` → `signin.js` → `VetraAPI.request("/auth/signin")` → `auth.routes.js` (password via `utils/password.js`, optional code via `two_factor_codes`) → token from `utils/jwt.js` → `api-client.js` stores it under the role's key → the dashboard. Every later request carries it; `middleware/auth.js` re-checks the account each time. Google: `google-signin.js` → `/auth/google` → `utils/googleAuth.js`.

**Browsing.** `dashboard.html` / `explore.html` → `products.js` (`GET /products`) → `product-grid.js` builds cards → `badges.js`, `filters.js`. Clicking a card → `product.html?id=`; a store → `store.html?vendor=` (`vendors.js`, `reviews.js`).

**Buying.** Add to Cart (`interactions.js`) → `cart-store.js` (`localStorage`) → `cart.html` / `cart.js` → delivery quote (`/delivery/quote`, `utils/delivery.js`) → `POST /payments/checkout` (`utils/payments.js` reserves stock, stores a `payments` row) → Flutterwave's page → back to `orders.html?payment=` and Flutterwave's webhook (`payments.routes.js`) → `finalizePayment()` creates one order per store, a delivery for each, notifications (`notify.js`) and emails (`orderEmail.js`).

**Delivering.** The vendor marks the order ready (`vendor/assets/orders.js`) → a rider is assigned (`admin/assets/deliveries.js` or automatically by `utils/delivery.js`) → the rider accepts, enters the vendor's pickup code, then the buyer's code (`rider/assets/rider.js`) → the buyer sees each step in `customer/assets/orders.js` and anyone with the tracking ID in `track.html`. The rider is paid at once; escrow releases to the vendor when the buyer confirms or the window passes (the sweep). See `DELIVERY_SYSTEM.md`.

**Disputes.** `customer/assets/report-issue.js` → `POST /reports` (holds escrow) → the vendor responds in `vendor/assets/reports.js` → an admin decides in `admin/assets/reports.js`; refunds go through `utils/payments.js`.

**Uploading a file.** Any form → `VetraAPI.uploadFile()` → `POST /uploads` → `utils/storage.js` → a URL on `vetrahq.org/uploads` (or a private KYC link) → saved on the record, checked by `utils/safeUrl.js`.

**Admin moderation.** An admin page's script → `/api/admin/...` → `requireAdminRole(...)` → the change, `activityLog.js`, `notify.js`, and emails → visible in `admin/activity.html`.

---

## 6. Redundancies cleaned up (2026-11-25)

- Deleted five unused images: `customer/assets/images/cat-fashion.jpg`, `cat-gaming.jpg`, `cat-phones.jpg`, and both `product-placeholder.jpg` files.
- `support.js` was the same file in `customer/assets/` and `vendor/assets/`; there is now one copy at the project root.
- `avatar-placeholder.svg` (three copies) and `product-placeholder.svg` (two) now live once each in `assets/`. The empty `customer/imgs/`, `vendor/imgs/` and `admin/imgs/` folders are gone.
- `admin/assets/ui.js`, `customer/assets/product-grid.js` and `customer/assets/reviews.js` no longer carry their own HTML escaper; they call `VetraAPI.escapeHtml()`.

Still left as they are:

| What | Why |
|---|---|
| `customer/category.html` (a redirect to `explore.html`) | Keeps old links working. It is not in the sitemap. |
| Comments in `backend/src/routes/admin.routes.js` and `admin/assets/session.js` that mention the deleted `admin/assets/data.js` mock | History only; no effect on behaviour. |
| `.claude/settings.json` holds one-off permissions from old sessions | Tooling, not part of the site; trim when convenient. |

---

## 7. Not built yet

- **Buyer ↔ vendor chat.** No tables, routes or page. Buyers use Smartsupp live chat with VETRA instead.
- **The AI shopping assistant on a page.** `POST /api/assistant/chat` works; nothing calls it.
- **Guest checkout in the cart.** The platform setting exists, but `cart.js` still asks the buyer to sign in.
- **Pagination.** Lists stop at 200 rows (100 for notifications).
- **Automated tests.** Everything has been checked by hand (`backend/README.md`, "What has been checked").

---

## 8. Design system reference (for anyone extending a page)

The look follows Apple's Human Interface Guidelines: the system font, one type scale, neutral system greys with a single accent (VETRA blue, `#1e4fef` light / `#6d93ff` for text in dark), no gradients, hairline separators instead of heavy shadows, translucent bars, sentence case everywhere, and 44px minimum touch targets (50px for primary buttons and the rider app's actions). All values come from `vetra-tokens.css`; contrast was checked to WCAG AA for every text/surface pair in both themes (`--c-text-3` is for placeholders and disabled states only).

Building blocks, shared by customer, vendor and admin (the shell is word-for-word the same in all three stylesheets):

- **Shell:** `.app-shell` → `.sidebar` (desktop source list: translucent, light, accent-tinted selected row) + `.phone` (scroll container) → `header#app-header` (sticky translucent top bar; its logo hides on desktop, where the sidebar shows it) → `main.page-shell` → `nav.bottom-nav` (iOS tab bar: translucent, selected tab marked by colour only).
- **Titles:** page titles are Large Title (`.page-header h1`, `.vendor-page-header h1`), section titles Title 3 (`.cat-head h3`), all sentence case. "See more"-style links are plain accent text (`.see-more`, `.page-link`).
- **Buttons:** filled accent for the primary action (`.primary-btn`, `.btn-save`, `.btn-primary`, `.continue-btn`), accent tint for secondary actions (`.secondary-btn`, `.btn-cancel`, `.btn-ghost`, `.btn-view`), status tints for row actions (`.btn-approve`, `.btn-suspend`, `.btn-reject`).
- **Segmented controls:** `.order-filter-tabs .filter-tab` (also vendor product categories, admin filters, payout status), `.toggle` (Buyer/Vendor on sign-in), `.rider-tabs`. A grey track with the selected segment raised in `--c-segment`; scrolls sideways when the segments don't fit.
- **Cards and lists:** `.vendor-section`, `.page-card`, `.categories`, `.stat-card` (plain surfaces, `--r-lg`, hairline border); `.data-table` with sticky headers and hairline rows.
- **Forms:** `.form-input` / `.form-textarea` / `.field-group input` / `.input-wrap input` are filled wells with an accent focus ring when focused. `.switch` and `.toggle-switch` are iOS switches (51×31, green when on).
- **Pills:** `.status-pill`, `.badge`: caption size, status colour on its tint.
- **Modals:** `.modal-overlay` (scrim) + `.modal-panel` (a sheet: `--r-xl`, float shadow).
- **Public site:** sticky translucent header, the hero as a single-colour headline beside a photo mosaic, light grouped sections (`.on-navy`, `.cta-band` and the footer all use `--c-surface-2`, despite the old class names).
