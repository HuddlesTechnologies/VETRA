/* =========================================================
   VETRA: installable app support. There are two installable apps:
   "VETRA" for buyers and vendors (../manifest.webmanifest, which opens
   app.html and routes to the right dashboard) and "VETRA Rider"
   (rider/manifest.webmanifest). Their pages load this file, which:
     1. registers the service worker (../sw.js, site root), which is
        what browsers require before offering "Install app";
     2. shows a small "Install the app" bar when the browser allows it
        (Chrome, Edge, Samsung Internet on Android and desktop), or a
        one-time "Add to Home Screen" tip on iPhone/iPad Safari, which
        has no install prompt of its own.
   Nothing shows once the app is installed and running standalone, and
   a dismissal is remembered for 14 days per app.
   ========================================================= */

(function () {
  if (!("serviceWorker" in navigator)) return;

  const script = document.currentScript;
  const root = new URL("./", script ? script.src : location.href); // site root, where sw.js lives
  const app = /\/vendor\//.test(location.pathname) ? "vendor" : /\/rider\//.test(location.pathname) ? "rider" : "customer";
  // Buyers and vendors share one installed app ("VETRA", root
  // manifest.webmanifest, opening app.html); riders have their own.
  const installId = app === "rider" ? "rider" : "main";
  const NAMES = { customer: "VETRA", vendor: "VETRA", rider: "VETRA Rider" };
  const PITCH = {
    customer: "Shop faster, track orders and get delivery updates from your home screen.",
    vendor: "Manage orders, products and payouts from your home screen.",
    rider: "Get to your deliveries faster from your home screen.",
  };
  const DISMISS_KEY = `vetra_pwa_dismissed_${installId}`;

  // app.html (the installed app's start page) reopens whichever side,
  // shopping or selling, was used last.
  if (app !== "rider" && /\/(customer|vendor)\//.test(location.pathname)) {
    try {
      localStorage.setItem("vetra_last_app", app);
    } catch (e) {}
  }
  const DISMISS_DAYS = 14;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("sw.js", root).href, { scope: root.pathname }).catch(() => {
      /* install support is optional, the site works without it */
    });
    // Push notifications on this device (push.js), on the signed-in apps only.
    if (/\/(customer|vendor|rider)\//.test(location.pathname) && typeof VetraAPI !== "undefined") {
      const s = document.createElement("script");
      // Same ?v= deploy stamp as this file (deploy/stamp-assets.sh), so a
      // deploy reaches it at once like every other script.
      s.src = new URL("push.js", root).href + (script ? new URL(script.src).search : "");
      s.async = true;
      document.head.appendChild(s);
    }
  });

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone) return;

  function recentlyDismissed() {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return at && Date.now() - at < DISMISS_DAYS * 864e5;
    } catch (e) {
      return false;
    }
  }
  function rememberDismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (e) {}
  }

  function injectStyles() {
    if (document.getElementById("vetra-pwa-style")) return;
    const style = document.createElement("style");
    style.id = "vetra-pwa-style";
    style.textContent = `
      .vetra-install {
        position: fixed; z-index: 9000; left: 12px; right: 12px;
        bottom: calc(76px + env(safe-area-inset-bottom, 0px));
        max-width: 440px; margin: 0 auto;
        display: flex; align-items: center; gap: 12px;
        padding: 12px 12px 12px 14px; border-radius: 18px;
        background: var(--c-material-solid, #fff); color: var(--c-text, #1d1d1f);
        border: 1px solid var(--c-sep, rgba(60,60,67,.18));
        box-shadow: var(--shadow-float, 0 12px 40px rgba(0,0,0,.14));
        font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
        animation: vetra-install-in .28s cubic-bezier(.25,.1,.25,1);
      }
      @media (min-width: 900px) { .vetra-install { left: auto; right: 24px; bottom: 24px; } }
      /* Pages without a tab bar (landing, sign-in, sign-up) show the live
         chat button in the bottom-right corner (56px tall, 24px from the
         edge), so the bar sits above it with a clear gap instead of under it. */
      .vetra-install.above-chat { bottom: calc(96px + env(safe-area-inset-bottom, 0px)); }
      @media (min-width: 900px) { .vetra-install.above-chat { right: 12px; bottom: 96px; } }
      @keyframes vetra-install-in { from { opacity: 0; transform: translateY(12px); } }
      @media (prefers-reduced-motion: reduce) { .vetra-install { animation: none; } }
      .vetra-install img { width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0; border: 1px solid var(--c-sep, #e5e5ea); }
      .vetra-install-text { flex: 1; min-width: 0; }
      .vetra-install-text strong { display: block; font-size: 14.5px; }
      .vetra-install-text span { display: block; color: var(--c-text-2, #6e6e73); font-size: 12.5px; margin-top: 2px; }
      .vetra-install-go {
        border: 0; border-radius: 999px; padding: 9px 16px; font: inherit; font-weight: 600; cursor: pointer;
        background: var(--c-accent-fill, #1e4fef); color: var(--c-on-accent, #fff); flex-shrink: 0;
      }
      .vetra-install-close {
        border: 0; background: none; cursor: pointer; padding: 4px; margin-left: -4px;
        color: var(--c-text-3, #86868b); font-size: 20px; line-height: 1; flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);
  }

  function showBar({ text, action }) {
    if (document.querySelector(".vetra-install")) return;
    injectStyles();
    const bar = document.createElement("div");
    bar.className = "vetra-install";
    // The apps hide the chat bubble and have a tab bar; everywhere else the
    // bubble is visible in the corner the bar would otherwise cover.
    if (!document.querySelector(".bottom-nav, #app-bottomnav, .rider-bottom-nav")) {
      bar.classList.add("above-chat");
    }
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", `Install ${NAMES[app]}`);
    bar.innerHTML = `
      <img src="${new URL("assets/brand/app/icon-192.png", root).href}" alt="" />
      <div class="vetra-install-text"><strong>Install ${NAMES[app]}</strong><span></span></div>
      ${action ? '<button type="button" class="vetra-install-go">Install</button>' : ""}
      <button type="button" class="vetra-install-close" aria-label="Not now">×</button>`;
    bar.querySelector(".vetra-install-text span").textContent = text;
    bar.querySelector(".vetra-install-close").addEventListener("click", () => {
      rememberDismiss();
      bar.remove();
    });
    if (action) {
      bar.querySelector(".vetra-install-go").addEventListener("click", async () => {
        bar.remove();
        await action();
      });
    }
    document.body.appendChild(bar);
  }

  // Chrome / Edge / Samsung Internet
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (recentlyDismissed()) return;
    showBar({
      text: PITCH[app],
      action: async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice.catch(() => null);
        if (!choice || choice.outcome !== "accepted") rememberDismiss();
        deferredPrompt = null;
      },
    });
  });
  window.addEventListener("appinstalled", () => {
    document.querySelector(".vetra-install")?.remove();
    deferredPrompt = null;
  });

  // iPhone / iPad Safari: no prompt API, so explain the two taps once.
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  if (isIOS && isSafari && !recentlyDismissed()) {
    window.addEventListener("load", () => {
      setTimeout(() => showBar({ text: "Tap the Share button, then “Add to Home Screen”." }), 2500);
    });
  }

  // Lets a page offer its own "Install app" button (e.g. in settings).
  window.VetraPWA = {
    canInstall: () => !!deferredPrompt,
    install: async () => {
      if (!deferredPrompt) return false;
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      return !!choice && choice.outcome === "accepted";
    },
  };
})();
