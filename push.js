/* =========================================================
   VETRA: push notifications on this device (phone or computer).
   Loaded by pwa.js on every customer, vendor and rider page.

   - Shows a "Get notifications on this phone" card wherever a page has
     a [data-push-prompt] element (notifications pages, vendor dashboard,
     rider home). The browser only allows asking from a tap, so it's a
     button, never an automatic prompt.
   - On iPhone/iPad, push only works once VETRA is added to the Home
     Screen (iOS 16.4+), so Safari gets that instruction instead.
   - Once on, every visit quietly re-sends the subscription so it stays
     attached to whoever is signed in, and the browser's rotated keys
     reach the server.

   Server side: backend/src/routes/notifications.routes.js (/push/*) and
   backend/src/utils/push.js. Shown in the service worker by ../sw.js.
   ========================================================= */

(function () {
  if (typeof VetraAPI === "undefined") return;

  const path = location.pathname;
  const role = /\/vendor\//.test(path) ? "vendor" : /\/rider\//.test(path) ? "rider" : /\/customer\//.test(path) ? "buyer" : null;
  if (!role) return;

  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  const ENDPOINT_KEY = `vetra_push_endpoint_${role}`;
  const SYNC_KEY = `vetra_push_synced_${role}`;
  const DISMISS_KEY = `vetra_push_dismissed_${role}`;
  const DISMISS_DAYS = 21;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  let keyPromise = null;
  function serverKey() {
    if (!keyPromise) {
      keyPromise = VetraAPI.request("/notifications/push/key", { role }).catch(() => ({ enabled: false }));
    }
    return keyPromise;
  }

  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function registration() {
    return navigator.serviceWorker.ready;
  }

  async function sendToServer(subscription) {
    await VetraAPI.request("/notifications/push/subscribe", {
      method: "POST",
      role,
      body: { subscription: subscription.toJSON() },
    });
    store.set(ENDPOINT_KEY, subscription.endpoint);
    store.set(SYNC_KEY, String(Date.now()));
  }

  async function subscribe() {
    const key = await serverKey();
    if (!key.enabled || !key.publicKey) throw new Error("Notifications aren't available yet. Try again later.");
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    // A subscription made with a different server key can't be reused.
    if (sub && sub.options && sub.options.applicationServerKey) {
      const current = new Uint8Array(sub.options.applicationServerKey);
      const wanted = urlBase64ToUint8Array(key.publicKey);
      if (current.length !== wanted.length || current.some((b, i) => b !== wanted[i])) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.publicKey) });
    }
    await sendToServer(sub);
    return sub;
  }

  /** "unsupported" | "needs-install" | "unavailable" | "denied" | "on" | "off" */
  async function state() {
    if (ios && !standalone) return "needs-install";
    if (!supported) return "unsupported";
    const key = await serverKey();
    if (!key.enabled) return "unavailable";
    if (Notification.permission === "denied") return "denied";
    if (Notification.permission !== "granted") return "off";
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    return sub && store.get(ENDPOINT_KEY) === sub.endpoint ? "on" : "off";
  }

  async function enable() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      const err = new Error(permission === "denied"
        ? "Notifications are blocked for VETRA. Allow them in your browser or phone settings, then try again."
        : "Notifications weren't turned on.");
      err.code = permission;
      throw err;
    }
    await subscribe();
  }

  async function disable() {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await VetraAPI.request("/notifications/push/unsubscribe", { method: "POST", role, body: { endpoint: sub.endpoint } }).catch(() => {});
    }
    // The browser subscription is shared by every VETRA account signed in
    // here (a buyer who also sells), so it's only dropped server-side for
    // this account; the browser keeps it for the others.
    store.del(ENDPOINT_KEY);
    store.del(SYNC_KEY);
  }

  // Quietly keep an existing subscription attached to the signed-in
  // account, at most once a day per account.
  async function sync(force) {
    if (!supported || Notification.permission !== "granted" || !VetraAPI.getToken(role)) return;
    if (!store.get(ENDPOINT_KEY)) return; // never turned on for this account here
    const last = Number(store.get(SYNC_KEY) || 0);
    if (!force && Date.now() - last < 864e5) return;
    try {
      await subscribe();
    } catch (e) {
      /* tried again next visit */
    }
  }

  // ---------- The opt-in card ----------

  const COPY = {
    buyer: "Get order and delivery updates on this device, even when VETRA is closed.",
    vendor: "Get new orders, payouts and stock alerts on this device, even when VETRA is closed.",
    rider: "Get new delivery jobs on this phone the moment they're offered, even when VETRA is closed.",
  };

  function injectStyles() {
    if (document.getElementById("vetra-push-style")) return;
    const style = document.createElement("style");
    style.id = "vetra-push-style";
    style.textContent = `
      .vetra-push {
        display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        padding: 14px 16px; margin: 0 0 16px; border-radius: 14px;
        background: var(--c-material-solid, #fff); color: var(--c-text, #1d1d1f);
        border: 1px solid var(--c-sep, rgba(60,60,67,.18));
        font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
      }
      .vetra-push-icon { width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0; display: grid; place-items: center;
        background: var(--c-accent-tint, rgba(30,79,239,.1)); color: var(--c-accent, #1e4fef); }
      .vetra-push-text { flex: 1 1 200px; min-width: 0; }
      .vetra-push-text strong { display: block; font-size: 14.5px; }
      .vetra-push-text span { display: block; color: var(--c-text-2, #6e6e73); font-size: 13px; margin-top: 2px; }
      .vetra-push-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .vetra-push-btn { border: 0; border-radius: 999px; padding: 8px 16px; font: inherit; font-weight: 600; cursor: pointer;
        background: var(--c-accent-fill, #1e4fef); color: var(--c-on-accent, #fff); }
      .vetra-push-btn[disabled] { opacity: .6; cursor: default; }
      .vetra-push-link { border: 0; background: none; padding: 6px 4px; font: inherit; font-size: 13px; cursor: pointer; color: var(--c-text-2, #6e6e73); }
      .vetra-push-link:hover { color: var(--c-text, #1d1d1f); }
      .vetra-push-error { flex-basis: 100%; margin: 0; font-size: 13px; color: var(--c-red, #d70015); }
    `;
    document.head.appendChild(style);
  }

  const BELL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

  function recentlyDismissed() {
    const at = Number(store.get(DISMISS_KEY) || 0);
    return at && Date.now() - at < DISMISS_DAYS * 864e5;
  }

  async function render(slot) {
    // "persistent" slots (the notifications page) always show the current
    // state with on/off controls; others only invite, and can be dismissed.
    const persistent = slot.dataset.pushPrompt === "persistent";
    const current = await state().catch(() => "unsupported");
    const esc = VetraAPI.escapeHtml;

    let title = "";
    let text = "";
    let actions = "";
    if (current === "unsupported" || current === "unavailable") {
      slot.hidden = true;
      return;
    }
    if (current === "on") {
      if (!persistent) { slot.hidden = true; return; }
      title = "Notifications are on for this device";
      text = "You'll get VETRA updates here even when the app is closed.";
      actions = '<button type="button" class="vetra-push-link" data-act="test">Send a test</button><button type="button" class="vetra-push-link" data-act="off">Turn off</button>';
    } else if (current === "needs-install") {
      if (!persistent && recentlyDismissed()) { slot.hidden = true; return; }
      title = "Get notifications on your iPhone";
      text = "Tap the Share button, then Add to Home Screen. Open VETRA from your Home Screen and turn notifications on there.";
      actions = persistent ? "" : '<button type="button" class="vetra-push-link" data-act="dismiss">Not now</button>';
    } else if (current === "denied") {
      if (!persistent) { slot.hidden = true; return; }
      title = "Notifications are blocked";
      text = "Allow notifications for VETRA in your browser or phone settings to get updates on this device.";
    } else {
      if (!persistent && recentlyDismissed()) { slot.hidden = true; return; }
      title = "Turn on notifications";
      text = COPY[role];
      actions = `<button type="button" class="vetra-push-btn" data-act="on">Turn on</button>${persistent ? "" : '<button type="button" class="vetra-push-link" data-act="dismiss">Not now</button>'}`;
    }

    injectStyles();
    slot.hidden = false;
    slot.innerHTML = `
      <div class="vetra-push" role="region" aria-label="Notifications on this device">
        <span class="vetra-push-icon">${BELL}</span>
        <div class="vetra-push-text"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>
        ${actions ? `<div class="vetra-push-actions">${actions}</div>` : ""}
        <p class="vetra-push-error" hidden></p>
      </div>`;

    const errorEl = slot.querySelector(".vetra-push-error");
    slot.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        errorEl.hidden = true;
        if (act === "dismiss") {
          store.set(DISMISS_KEY, String(Date.now()));
          slot.hidden = true;
          return;
        }
        btn.disabled = true;
        try {
          if (act === "on") await enable();
          if (act === "off") await disable();
          if (act === "test") {
            await VetraAPI.request("/notifications/push/test", { method: "POST", role });
            btn.textContent = "Sent";
            return;
          }
          await render(slot);
        } catch (e) {
          errorEl.textContent = e.message || "Something went wrong. Try again.";
          errorEl.hidden = false;
          btn.disabled = false;
          if (e.code === "denied") render(slot);
        }
      });
    });
  }

  function mountAll() {
    document.querySelectorAll("[data-push-prompt]").forEach((slot) => {
      if (VetraAPI.getToken(role)) render(slot);
    });
  }

  if (supported) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "vetra-push-resync") sync(true);
    });
  }

  window.VetraPush = { state, enable, disable, sync, mount: render };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll);
  else mountAll();
  sync(false);
})();
