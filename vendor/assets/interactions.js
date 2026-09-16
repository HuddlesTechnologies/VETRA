/* =========================================================
   VETRA — SHARED PAGE INTERACTIONS (vendor)

   Every vendor page's header / sidebar / bottom-nav markup lives
   directly in each page's own HTML now (it used to be built at
   runtime by this file). This file only wires up behavior on
   elements that already exist in the DOM when the page loads:
     - the header's sidebar toggle + the floating reopen button
     - the sidebar's collapse (icon-only) chevron
   The header's support icon (.support-btn) opens Smartsupp live chat
   instead — see assets/support.js, shared with the customer side.
   ========================================================= */

const VetraUI = (() => {
  // ---- Require a real, signed-in vendor session ----
  // Unlike the customer app (which deliberately allows guest browsing —
  // see signin.html's "Continue as Guest" link), there's no such thing
  // as a guest vendor: every vendor page assumes a real account. Runs
  // first in init(), before anything else on the page, so an
  // unauthenticated visit never renders vendor data at all.
  function requireVendorSession() {
    if (typeof VetraAPI === "undefined" || !VetraAPI.getToken("vendor")) {
      window.location.href = "../signin.html#Vendor";
      return false;
    }
    return true;
  }

  function wireSidebarToggle() {
    const toggleBtn = document.getElementById("header-sidebar-toggle");
    const sidebar = document.getElementById("app-sidebar");
    const reopenBtn = document.getElementById("app-sidebar-reopen");
    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener("click", () => {
        sidebar.classList.toggle("hidden-desktop");
        const isHidden = sidebar.classList.contains("hidden-desktop");
        sidebar.style.display = isHidden ? "none" : "";
        if (reopenBtn) reopenBtn.classList.toggle("show", isHidden);
      });
    }
    if (reopenBtn && sidebar) {
      reopenBtn.addEventListener("click", () => {
        sidebar.classList.remove("hidden-desktop");
        sidebar.style.display = "";
        reopenBtn.classList.remove("show");
      });
    }
  }

  function wireSidebarCollapse() {
    const collapseBtn = document.getElementById("sidebar-collapse-toggle");
    const sidebar = document.getElementById("app-sidebar");
    if (collapseBtn && sidebar) {
      collapseBtn.addEventListener("click", () => {
        sidebar.classList.toggle("collapsed");
      });
    }
  }

  // ---- Reflect the real signed-in vendor's avatar in every page's
  // header, since it's the same header markup on every vendor page.
  // Reads the real session (cached from sign-in/signup, or the last
  // avatar upload — see vendor/assets/profile.js) instead of a
  // per-browser localStorage mock; a brand-new store with no avatarUrl
  // yet just keeps the default placeholder already in the HTML. Called
  // on every page load, and again by profile.js right after a new
  // photo is saved, so the header updates immediately instead of only
  // on the next navigation.
  function applyCurrentVendorAvatar() {
    if (typeof VetraAPI === "undefined") return;
    const me = VetraAPI.getUser("vendor");
    if (!me || !me.avatarUrl) return;
    document.querySelectorAll(".header-avatar img").forEach((img) => {
      img.src = me.avatarUrl;
    });
  }

  function init() {
    if (!requireVendorSession()) return;
    wireSidebarToggle();
    wireSidebarCollapse();
    applyCurrentVendorAvatar();
  }

  return {
    requireVendorSession,
    wireSidebarToggle,
    wireSidebarCollapse,
    applyCurrentVendorAvatar,
    init,
  };
})();

document.addEventListener("DOMContentLoaded", () => VetraUI.init());
