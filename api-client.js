/* =========================================================
   VETRA — SHARED API CLIENT
   One fetch wrapper for the real backend (see BACKEND_GUIDE.md),
   used by every app — public site, customer, vendor, admin. Lives at
   the project root and is referenced via a relative path from
   wherever it's needed, same precedent as password-toggle.js: this
   is infrastructure with zero reason to differ per app, unlike
   interactions.js/support.js which are deliberately app-specific.

   Token storage: one localStorage key per role, not one shared key —
   a single browser can plausibly be signed in as a buyer AND a
   vendor AND an admin at once (three separate apps, testing in
   different tabs), and a shared key would make one session silently
   clobber another.

   VETRA_API_BASE is the one thing to change if this backend ever
   moves — everything else in this file (and every caller) is
   independent of the actual host.
   ========================================================= */

const VETRA_API_BASE = "https://vetra-api-11an.onrender.com/api";

const VetraAPI = (() => {
  const TOKEN_KEYS = {
    buyer: "vetra_buyer_token",
    vendor: "vetra_vendor_token",
    admin: "vetra_admin_token",
  };
  const USER_KEYS = {
    buyer: "vetra_buyer_user",
    vendor: "vetra_vendor_user",
    admin: "vetra_admin_user",
  };

  function getToken(role) {
    try {
      return localStorage.getItem(TOKEN_KEYS[role]);
    } catch (e) {
      return null; // localStorage unavailable (private mode, etc.)
    }
  }

  function setSession(role, token, user) {
    try {
      localStorage.setItem(TOKEN_KEYS[role], token);
      localStorage.setItem(USER_KEYS[role], JSON.stringify(user));
    } catch (e) {
      /* ignore write failures — the session still works for this page view */
    }
  }

  function getUser(role) {
    try {
      const raw = localStorage.getItem(USER_KEYS[role]);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearSession(role) {
    try {
      localStorage.removeItem(TOKEN_KEYS[role]);
      localStorage.removeItem(USER_KEYS[role]);
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * @param {string} path - e.g. "/auth/signin"
   * @param {Object} [opts]
   * @param {string} [opts.method="GET"]
   * @param {"buyer"|"vendor"|"admin"} [opts.role] - attaches that role's bearer token if present
   * @param {Object|FormData} [opts.body]
   */
  async function request(path, opts = {}) {
    const { method = "GET", role, body } = opts;
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

    const headers = {};
    const token = role ? getToken(role) : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!isFormData && body !== undefined) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(`${VETRA_API_BASE}${path}`, {
        method,
        headers,
        body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // Network failure (offline, CORS, the free-tier host asleep and slow
      // to wake) — surfaced the same shape as a server error so callers
      // only need one catch block.
      const error = new Error("Couldn't reach the server. Check your connection and try again.");
      error.status = 0;
      throw error;
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* empty/non-JSON body — fine for a 204, or a route with no JSON reply */
    }

    if (!res.ok) {
      const error = new Error((data && data.error) || `Request failed (${res.status}).`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  /**
   * Uploads one File/Blob to POST /api/uploads and returns its URL.
   * `folder` only organizes the Cloudinary dashboard (kyc/products/
   * avatars/banners/etc) — see backend/src/routes/uploads.routes.js.
   */
  async function uploadFile(file, { role, folder } = {}) {
    const form = new FormData();
    form.append("file", file);
    if (folder) form.append("folder", folder);
    const result = await request("/uploads", { method: "POST", role, body: form });
    return result.url;
  }

  return { request, getToken, setSession, getUser, clearSession, uploadFile };
})();

/* ---------- Money helpers ----------
   Every price in the database (products.price, orders.total, etc.) is
   stored in kobo — see backend/migrations/001_init.sql's comment on
   products.price and backend/src/routes/assistant.routes.js's own
   `price / 100` when it formats a price for display. Naira only ever
   exists in the UI layer: a form field a person types into, or text on
   screen. Use these two conversions at that boundary instead of
   scattering `* 100` / `/ 100` through every page that touches money. */
function nairaToKobo(naira) {
  // Strips thousands-separator commas (vendor/assets/add-product.js's
  // live-formatted price field types "17,489", not "17489") before
  // parsing — harmless on a plain digit string too, so every existing
  // caller keeps working unchanged.
  return Math.round(Number(String(naira).replace(/,/g, "")) * 100);
}
function formatNaira(kobo) {
  return `₦${Math.round(Number(kobo) / 100).toLocaleString("en-NG")}`;
}

/* ---------- Order status helpers ----------
   Was independently copy-pasted (byte-identical) into customer/assets/
   orders.js, vendor/assets/orders.js, and both admin detail pages —
   one shared copy so the status→label mapping can't quietly drift
   between them. orders.status is stored with underscores
   (out_for_delivery) but the CSS/filter-tab markup everywhere uses
   hyphens (status-pill.out-for-delivery, data-filter="out-for-delivery");
   orderStatusSlug() is the one place that conversion happens. */
const ORDER_STATUS_LABEL = {
  pending: "pending",
  processing: "processing",
  shipped: "shipped",
  out_for_delivery: "out for delivery",
  completed: "delivered",
  cancelled: "cancelled",
};
function orderStatusSlug(status) {
  return String(status).replace(/_/g, "-");
}

/* ---------- Order reference formatting ----------
   "VTR" instead of the old bare "#" prefix, everywhere an order/report
   id is shown as a short reference (vendor orders list, admin, activity
   feeds, receipts) — matches formatRef() on the backend
   (backend/src/utils/id.js), which formats the same way server-side
   for anything baked into a stored message or email. The customer's
   own order-tracking view uses a different, wholly separate value
   (order.tracking_code, "VTA..." — generated once at checkout, not
   derived from the id) rather than this formatter. */
function formatOrderRef(id) {
  return `VTR-${String(id).slice(0, 8).toUpperCase()}`;
}

/* ---------- Nigeria-time formatting ----------
   VETRA is a Nigeria-specific marketplace — every timestamp shown
   anywhere in the UI should read the same regardless of which
   timezone the *viewer's own device* happens to be set to. Every
   date/time formatter below passes `timeZone: "Africa/Lagos"`
   explicitly; without it, `toLocaleString()`/`toLocaleDateString()`
   silently fall back to the browser's own local timezone — the
   `"en-NG"` locale argument alone only controls formatting style
   (date order, month names), not which timezone the clock reads in.
   A diaspora buyer and a Lagos-based vendor looking at the exact same
   order used to see two different times for the same real event.
   Africa/Lagos has no DST, so this is always a flat UTC+1 — no
   half-yearly offset flip to account for. */
const VETRA_TIME_ZONE = "Africa/Lagos";

function formatDateTimeNG(iso, opts) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-NG", { timeZone: VETRA_TIME_ZONE, ...(opts || {}) });
}

function formatDateNG(iso, opts) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NG", { timeZone: VETRA_TIME_ZONE, ...(opts || {}) });
}

function formatTimeNG(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-NG", { timeZone: VETRA_TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

// Relative time ("X ago"), detailed enough to actually be useful once
// it crosses into hours — a bare "3 hours ago" collapses anything
// from 3h00m to 3h59m into the same label; this instead shows "3h 24m
// ago" under a day old, then a real Africa/Lagos clock time once
// "N days ago" alone stops being precise enough at a glance.
function formatRelativeTimeNG(iso) {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins ? `${hours}h ${remMins}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  const timeLabel = formatTimeNG(iso);
  if (days < 7) return `${days === 1 ? "Yesterday" : `${days} days ago`}, ${timeLabel}`;
  return formatDateTimeNG(iso, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}
