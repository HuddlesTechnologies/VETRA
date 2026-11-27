/* =========================================================
   VETRA: Shared API client.
   One fetch wrapper for the real backend (see BACKEND_GUIDE.md),
   used by every app: public site, customer, vendor, admin. Lives at
   the project root and is referenced via a relative path from
   wherever it's needed, same precedent as password-toggle.js: this
   is infrastructure with zero reason to differ per app, unlike
   interactions.js, which is deliberately app-specific.

   Token storage: one localStorage key per role, not one shared key.
   A single browser can plausibly be signed in as a buyer AND a
   vendor AND an admin at once (three separate apps, testing in
   different tabs), and a shared key would make one session silently
   clobber another.

   VETRA_API_BASE is the one thing to change if this backend ever
   moves, everything else in this file (and every caller) is
   independent of the actual host.
   ========================================================= */

// The API on cPanel (backend/README.md, "Setting up on cPanel").
const VETRA_API_BASE = "https://api.vetrahq.org/api";

const VetraAPI = (() => {
  const TOKEN_KEYS = {
    buyer: "vetra_buyer_token",
    vendor: "vetra_vendor_token",
    admin: "vetra_admin_token",
    rider: "vetra_rider_token",
  };
  const USER_KEYS = {
    buyer: "vetra_buyer_user",
    vendor: "vetra_vendor_user",
    admin: "vetra_admin_user",
    rider: "vetra_rider_user",
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
      /* ignore write failures, the session still works for this page view */
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

  function clearSession(role, { keepPush = false } = {}) {
    // Stop this device getting push notifications for the account that's
    // signing out (push.js). keepalive, since sign-out navigates away
    // straight after; the endpoint is kept locally so this needs no await.
    // An expired session isn't the person leaving: they still want their
    // notifications, and get them again in full once signed back in.
    if (!keepPush) try {
      const pushKey = `vetra_push_endpoint_${role}`;
      const endpoint = localStorage.getItem(pushKey);
      const token = localStorage.getItem(TOKEN_KEYS[role]);
      if (endpoint && token && typeof fetch === "function") {
        fetch(`${VETRA_API_BASE}/notifications/push/unsubscribe`, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      localStorage.removeItem(pushKey);
      localStorage.removeItem(`vetra_push_synced_${role}`);
    } catch (e) {
      /* ignore */
    }
    try {
      localStorage.removeItem(TOKEN_KEYS[role]);
      localStorage.removeItem(USER_KEYS[role]);
    } catch (e) {
      /* ignore */
    }
  }

  let sessionRedirectStarted = false;

  function redirectAfterSessionExpiry(role) {
    if (sessionRedirectStarted || typeof window === "undefined") return;
    sessionRedirectStarted = true;
    clearSession(role, { keepPush: true });

    const loginPath = role === "admin" || role === "rider"
      ? "login.html"
      : role === "vendor"
        ? "../signin.html#Vendor"
        : "../signin.html";

    // shared-ui.js (VetraModal) is what every other in-app dialog routes
    // through as of the modal consolidation (see DOCUMENTATION.md item 40),
    // but this fires from api-client.js itself, which every page loads
    // first and standalone, so it can't assume VetraModal is present the
    // way a page's own UI code can. Guarded fallback to the native
    // alert() keeps this from silently doing nothing on the couple of
    // pages (admin/login.html, customer/category.html) that don't load
    // shared-ui.js at all.
    if (typeof VetraModal !== "undefined") {
      VetraModal.info({
        title: "Session expired",
        bodyHtml: "Your session has expired. Please log in again.",
        confirmLabel: "OK",
        onClose: () => window.location.replace(loginPath),
      });
    } else {
      window.alert("Your session has expired. Please log in again.");
      window.location.replace(loginPath);
    }
  }

  /**
   * @param {string} path - e.g. "/auth/signin"
   * @param {Object} [opts]
   * @param {string} [opts.method="GET"]
   * @param {"buyer"|"vendor"|"admin"|"rider"} [opts.role] - attaches that role's bearer token if present
   * @param {Object|FormData} [opts.body]
   */
  // A random ID for this browser, sent with every request so admins can
  // see (and ban) the devices an account uses. See backend/src/utils/devices.js.
  const DEVICE_KEY = "vetra_device_id";
  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id || !/^[A-Za-z0-9-]{16,64}$/.test(id)) {
        id = typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      return null;
    }
  }

  async function request(path, opts = {}) {
    const { method = "GET", role, body } = opts;
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

    const headers = {};
    const deviceId = getDeviceId();
    if (deviceId) headers["X-Device-Id"] = deviceId;
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
      // to wake), surfaced the same shape as a server error so callers
      // only need one catch block.
      const error = new Error("Couldn't reach the server. Check your connection and try again.");
      error.status = 0;
      throw error;
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* empty/non-JSON body, fine for a 204, or a route with no JSON reply */
    }

    if (!res.ok) {
      const sessionExpired = res.status === 401
        && /session expired due to inactivity|invalid or expired token|session revoked|account is no longer active/i.test(data?.error || "");
      if (sessionExpired && role) redirectAfterSessionExpiry(role);

      const error = new Error((data && data.error) || `Request failed (${res.status}).`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  /**
   * Uploads one File/Blob to POST /api/uploads and returns its URL.
   * `folder` is the sub-folder it's stored under (kyc/products/avatars/
   * banners/etc); "kyc" is stored privately. See backend/src/utils/storage.js.
   */
  // Same caps the API enforces (backend/src/routes/uploads.routes.js),
  // checked here first so nobody waits on an upload that will be refused.
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

  // Longest side photos are shrunk to before upload. The server resizes
  // again to its own per-folder limit (backend/src/utils/images.js), so
  // this only has to be at least that big.
  const CLIENT_MAX_SIDE = { avatars: 1000 };
  const CLIENT_DEFAULT_MAX_SIDE = 2400;
  const UPLOAD_TIMEOUT_MS = 120 * 1000;

  // A full-size phone photo is 3-8MB, which on mobile data is slow and is
  // what made uploads fail part-way. Re-encoding it here to a JPEG that
  // fits CLIENT_MAX_SIDE makes it a few hundred KB. Anything the browser
  // can't decode (HEIC in Chrome, for one), animated GIFs, and KYC
  // documents (kept untouched so every line stays legible) go up as they
  // are, and the server converts them.
  async function shrinkImage(file, folder) {
    const type = String(file.type || "").toLowerCase();
    if (folder === "kyc" || type === "image/gif" || type === "image/svg+xml") return file;
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
    const maxSide = CLIENT_MAX_SIDE[folder] || CLIENT_DEFAULT_MAX_SIDE;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      return file;
    }
    try {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      // Already small and a format the server reads quickly: nothing to gain.
      if (scale === 1 && file.size < 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(type)) return file;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      // JPEG has no transparency; white instead of black behind a PNG's clear areas.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob || blob.size >= file.size) return file;
      const base = String(file.name || "photo").replace(/\.[^.]+$/, "");
      return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
    } catch (e) {
      return file;
    } finally {
      if (bitmap && bitmap.close) bitmap.close();
    }
  }

  async function sendUpload(file, { role, folder }) {
    const form = new FormData();
    // folder goes first so the server knows it before the file arrives
    // (KYC uploads accept documents and a larger size than other folders).
    if (folder) form.append("folder", folder);
    form.append("file", file);
    const headers = {};
    const deviceId = getDeviceId();
    if (deviceId) headers["X-Device-Id"] = deviceId;
    const token = role ? getToken(role) : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    // A connection that stalls on mobile data otherwise leaves the page
    // on "Saving…" forever.
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetch(`${VETRA_API_BASE}/uploads`, {
        method: "POST",
        headers,
        body: form,
        signal: controller ? controller.signal : undefined,
      });
    } catch (e) {
      const timedOut = e && e.name === "AbortError";
      const error = new Error(
        timedOut
          ? "The upload took too long. Check your connection and try again."
          : "Couldn't reach the server. Check your connection and try again."
      );
      error.status = 0;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* a proxy error page, not JSON */
    }
    if (!res.ok) {
      const sessionExpired = res.status === 401
        && /session expired due to inactivity|invalid or expired token|session revoked|account is no longer active/i.test(data?.error || "");
      if (sessionExpired && role) redirectAfterSessionExpiry(role);
      const error = new Error(
        (data && data.error)
          || (res.status === 413 ? "That file is too large." : `Upload failed (${res.status}). Try again.`)
      );
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function uploadFile(file, { role, folder } = {}) {
    const type = String((file && file.type) || "");
    const name = String((file && file.name) || "");
    const isImage = /^image\//.test(type) || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(name);
    const isVideo = /^video\//.test(type) || /\.(mp4|mov|m4v|webm)$/i.test(name);
    if (isImage) file = await shrinkImage(file, folder);
    if (isImage && file.size > MAX_IMAGE_BYTES) {
      throw new Error("That image is over 10MB. Choose a smaller photo.");
    }
    if (isVideo && folder !== "kyc" && file.size > MAX_VIDEO_BYTES) {
      throw new Error("That video is over 20MB. Trim it or record a shorter clip.");
    }
    // One automatic retry when the connection dropped or the server was
    // briefly unavailable (a restart after a deploy answers 502/503). An
    // upload that failed this way stored nothing, so retrying is safe.
    let result;
    try {
      result = await sendUpload(file, { role, folder });
    } catch (e) {
      if (e.status !== 0 && e.status !== 502 && e.status !== 503 && e.status !== 504) throw e;
      await new Promise((r) => setTimeout(r, 2000));
      result = await sendUpload(file, { role, folder });
    }
    return result.url;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  return { request, getToken, setSession, getUser, clearSession, uploadFile, escapeHtml };
})();

function verifiedBadgeMarkup(isVerified) {
  return isVerified
    ? `<span class="verified-badge" role="img" aria-label="Verified vendor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.5 12.5 3 3 6-6"></path></svg></span>`
    : "";
}

/* ---------- Money helpers ----------
   Every price in the database (products.price, orders.total, etc.) is
   stored in kobo, see backend/migrations/001_init.sql's comment on
   products.price and backend/src/routes/assistant.routes.js's own
   `price / 100` when it formats a price for display. Naira only ever
   exists in the UI layer: a form field a person types into, or text on
   screen. Use these two conversions at that boundary instead of
   scattering `* 100` / `/ 100` through every page that touches money. */
function nairaToKobo(naira) {
  // Strips thousands-separator commas (vendor/assets/add-product.js's
  // live-formatted price field types "17,489", not "17489") before
  // parsing, harmless on a plain digit string too, so every existing
  // caller keeps working unchanged.
  return Math.round(Number(String(naira).replace(/,/g, "")) * 100);
}
function formatNaira(kobo) {
  return `₦${Math.round(Number(kobo) / 100).toLocaleString("en-NG")}`;
}

// Roughly Flutterwave's fee (2% on local payments plus 7.5% VAT on the
// fee), which Flutterwave adds at its own checkout since customers bear
// the fees. Display only, so the cart total is close to what the buyer
// actually pays; the same formula as backend/src/utils/payments.js's
// processingFee().
function processingFee(netKobo) {
  if (netKobo <= 0) return 0;
  return Math.ceil(netKobo * 0.02 * 1.075);
}

/* ---------- Order status helpers ----------
   Was independently copy-pasted (byte-identical) into customer/assets/
   orders.js, vendor/assets/orders.js, and both admin detail pages,
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

/* ---------- Delivery helpers ----------
   deliveries.status (backend/src/utils/delivery.js) is finer-grained
   than orders.status: it says who has the parcel right now, which is
   what the buyer's tracking panel, the vendor's order row, the rider
   app, and the admin dispatch console all need to show. One shared
   label map, same reasoning as ORDER_STATUS_LABEL above. */
const DELIVERY_STATUS_LABEL = {
  awaiting_vendor: "Vendor is packing",
  ready: "Waiting for a rider",
  assigned: "Rider being assigned",
  accepted: "Rider heading to pick up",
  picked_up: "Picked up",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  returning: "Returning to vendor",
  returned: "Returned to vendor",
  cancelled: "Cancelled",
};

const RIDER_VEHICLE_LABEL = { bicycle: "Bicycle", motorbike: "Motorbike", car: "Car", van: "Van" };

// Same list as backend/src/utils/nigerianStates.js, which validates it.
const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
  "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT (Abuja)",
];

function stateOptionsMarkup(selected) {
  return NIGERIAN_STATES
    .map((s) => `<option value="${s}"${s === selected ? " selected" : ""}>${s}</option>`)
    .join("");
}

// OpenStreetMap embed centred on a point, no API key needed. Used for
// the rider's live position on the buyer's tracking panel and track.html.
function riderMapEmbedMarkup(location) {
  if (!location) return "";
  const d = 0.008;
  const bbox = [location.lng - d, location.lat - d, location.lng + d, location.lat + d].join(",");
  return `<iframe class="rider-map" title="Rider location" loading="lazy"
    src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${location.lat},${location.lng}"></iframe>`;
}

/* ---------- Order ID ----------
   An order's one public ID is its tracking code ("VTA-XXXXXXXX",
   orders.tracking_code, UNIQUE in the database), shown identically to
   buyers, vendors, riders and admins and in every email and
   notification. Matches orderRef() in backend/src/utils/id.js. Orders
   placed before tracking codes existed fall back to their old
   "VTR-" + id-prefix reference, unique for them since their ids were
   random. Takes the order row. */
function formatOrderRef(order) {
  return order.tracking_code || `VTR-${String(order.id).slice(0, 8).toUpperCase()}`;
}

/* ---------- Nigeria-time formatting ----------
   VETRA is a Nigeria-specific marketplace, every timestamp shown
   anywhere in the UI should read the same regardless of which
   timezone the *viewer's own device* happens to be set to. Every
   date/time formatter below passes `timeZone: "Africa/Lagos"`
   explicitly; without it, `toLocaleString()`/`toLocaleDateString()`
   silently fall back to the browser's own local timezone. The
   `"en-NG"` locale argument alone only controls formatting style
   (date order, month names), not which timezone the clock reads in.
   A diaspora buyer and a Lagos-based vendor looking at the exact same
   order used to see two different times for the same real event.
   Africa/Lagos has no DST, so this is always a flat UTC+1, no
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
// it crosses into hours, a bare "3 hours ago" collapses anything
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
