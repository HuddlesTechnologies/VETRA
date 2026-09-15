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

  return { request, getToken, setSession, getUser, clearSession };
})();
