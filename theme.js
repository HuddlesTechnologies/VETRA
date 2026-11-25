/* =========================================================
   VETRA appearance: Light or Dark.
   Loaded in every page's <head>, before the stylesheets render, so the
   theme applies on first paint with no flash of the wrong one.

   Light is the default for everyone, whatever their device uses. The
   header button flips between Light and Dark and saves the choice per
   browser (localStorage "vetra_theme"); it's applied as
   data-theme="light" | "dark" on <html>, which vetra-tokens.css keys
   every colour off. The browser's own bar colour (meta theme-color)
   follows the choice too.

   The button goes in the page's header (public nav, the app top bars,
   the rider header, the sign-in top bar), or floats on pages without one.
   ========================================================= */

(function () {
  var KEY = "vetra_theme";
  var ICON = {
    // the icon shows what a click switches to
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    dark: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  };

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : null;
    } catch (e) {
      return null;
    }
  }

  function current() {
    return saved() || "light";
  }

  var BAR_COLOR = { light: "#f5f5f7", dark: "#000000" };

  function apply(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      metas[i].removeAttribute("media");
      metas[i].setAttribute("content", BAR_COLOR[mode]);
    }
  }

  apply(current());

  function render(button, mode) {
    var next = mode === "dark" ? "light" : "dark";
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[next] + "</svg>";
    button.setAttribute("aria-label", "Switch to " + next + " mode");
    button.title = "Switch to " + next + " mode";
  }

  function set(mode) {
    try {
      localStorage.setItem(KEY, mode);
    } catch (e) {
      /* storage blocked: the choice still applies for this page view */
    }
    apply(mode);
    document.querySelectorAll(".theme-toggle").forEach(function (b) {
      render(b, mode);
    });
  }

  var mounted = false;

  function makeButton() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    render(button, current());
    button.addEventListener("click", function () {
      set(current() === "dark" ? "light" : "dark");
    });
    return button;
  }

  function findSlot() {
    return (
      document.querySelector(".icon-actions") ||
      document.querySelector(".nav-cta") ||
      document.querySelector(".rider-header-right") ||
      document.querySelector(".rider-auth-nav")
    );
  }

  // Into the header as soon as it's parsed, not after every script on the
  // page has run: adding it late made the header icons jump sideways.
  function mountInSlot() {
    if (mounted) return true;
    var slot = findSlot();
    if (!slot) return false;
    slot.insertBefore(makeButton(), slot.firstChild);
    mounted = true;
    return true;
  }

  function mountFallback() {
    if (mounted || mountInSlot()) return;
    var button = makeButton();
    var topbar = document.querySelector(".topbar");
    if (topbar) {
      topbar.appendChild(button);
    } else {
      button.classList.add("floating");
      document.body.appendChild(button);
    }
    mounted = true;
  }

  // The meta tags come after this script in <head>: set them once parsed.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      apply(current());
    });
  }

  // Another tab changed it: follow along.
  window.addEventListener("storage", function (e) {
    if (e.key === KEY) set(current());
  });

  if (document.readyState === "loading") {
    if (window.MutationObserver) {
      var observer = new MutationObserver(function () {
        if (mountInSlot()) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener("DOMContentLoaded", function () {
        observer.disconnect();
        mountFallback();
      });
    } else {
      document.addEventListener("DOMContentLoaded", mountFallback);
    }
  } else {
    mountFallback();
  }

  window.VetraTheme = { get: current, set: set };
})();

/* ---------------------------------------------------------
   The VETRA logo leads to your dashboard.
   Inside an app (customer/, vendor/, admin/, rider/) every logo goes to
   that app's dashboard. On the public pages it goes to the dashboard of
   whoever is signed in (vendor, then buyer, then rider; never admin, so
   the admin console stays out of public pages), and to the home page
   only when nobody is. Sessions are read from the same localStorage
   keys api-client.js writes.
   --------------------------------------------------------- */
(function () {
  var APPS = {
    customer: { role: "buyer", home: "dashboard.html" },
    vendor: { role: "vendor", home: "dashboard.html" },
    admin: { role: "admin", home: "dashboard.html" },
    rider: { role: "rider", home: "index.html" },
  };
  var PUBLIC_ORDER = ["vendor", "customer", "rider"];

  function signedIn(role) {
    try {
      return !!localStorage.getItem("vetra_" + role + "_token");
    } catch (e) {
      return false;
    }
  }

  function destination() {
    var match = window.location.pathname.match(/\/(customer|vendor|admin|rider)\/[^/]*$/);
    if (match) return APPS[match[1]].home;
    for (var i = 0; i < PUBLIC_ORDER.length; i++) {
      var app = PUBLIC_ORDER[i];
      if (signedIn(APPS[app].role)) return app + "/" + APPS[app].home;
    }
    return null; // signed out on a public page: leave the logo as it is
  }

  function go(e) {
    var dest = destination();
    if (!dest) return;
    e.preventDefault();
    window.location.href = dest;
  }

  function wire() {
    var dest = destination();
    if (!dest) return;
    document.querySelectorAll(".vetra-logo").forEach(function (logo) {
      var link = logo.closest("a");
      if (link) {
        // A real link keeps open-in-new-tab working.
        link.setAttribute("href", dest);
        return;
      }
      if (logo.dataset.homeWired) return;
      logo.dataset.homeWired = "1";
      logo.style.cursor = "pointer";
      logo.setAttribute("role", "link");
      logo.setAttribute("tabindex", "0");
      logo.setAttribute("aria-label", "Go to dashboard");
      logo.addEventListener("click", go);
      logo.addEventListener("keydown", function (e) {
        if (e.key === "Enter") go(e);
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
