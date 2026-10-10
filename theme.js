/* =========================================================
   VETRA appearance: Automatic (follow the device), Light or Dark.
   Loaded in every page's <head>, before the stylesheets render, so a
   saved choice applies on first paint with no flash of the wrong theme.

   The choice is stored per browser (localStorage "vetra_theme") and
   applied as data-theme="light" | "dark" on <html>; with no choice the
   attribute is absent and vetra-tokens.css follows the device setting.

   Adds an appearance button to the page's header (public nav, the app
   top bars, the rider header, the sign-in top bar), or a small floating
   one on pages without a header. Each click cycles
   Automatic -> Light -> Dark -> Automatic.
   ========================================================= */

(function () {
  var KEY = "vetra_theme";
  var MODES = ["auto", "light", "dark"];
  var LABEL = { auto: "Automatic", light: "Light", dark: "Dark" };
  var ICON = {
    // half-filled circle: follows the device
    auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    dark: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  };

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "auto";
    } catch (e) {
      return "auto";
    }
  }

  function apply(mode) {
    var root = document.documentElement;
    if (mode === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
  }

  apply(read());

  function render(button, mode) {
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[mode] + "</svg>";
    var text = "Appearance: " + LABEL[mode] + ". Click to change.";
    button.setAttribute("aria-label", text);
    button.title = "Appearance: " + LABEL[mode];
  }

  function set(mode) {
    try {
      if (mode === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch (e) {
      /* storage blocked: the choice still applies for this page view */
    }
    apply(mode);
    document.querySelectorAll(".theme-toggle").forEach(function (b) {
      render(b, mode);
    });
  }

  function mount() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    render(button, read());
    button.addEventListener("click", function () {
      var next = MODES[(MODES.indexOf(read()) + 1) % MODES.length];
      set(next);
    });

    var slot =
      document.querySelector(".icon-actions") ||
      document.querySelector(".nav-cta") ||
      document.querySelector(".rider-header-right");
    if (slot) {
      slot.insertBefore(button, slot.firstChild);
      return;
    }
    var topbar = document.querySelector(".topbar");
    if (topbar) {
      topbar.appendChild(button);
      return;
    }
    button.classList.add("floating");
    document.body.appendChild(button);
  }

  // Another tab changed it: follow along.
  window.addEventListener("storage", function (e) {
    if (e.key === KEY) set(read());
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  window.VetraTheme = { get: read, set: set };
})();
