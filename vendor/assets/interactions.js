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

  // ---- Reflect the saved profile photo in every page's header ----
  // vendor/assets/profile.js saves a chosen avatar to this same
  // localStorage key (see AVATAR_PHOTO_KEY there); this just needs to
  // read it back, since every vendor page shares the same header
  // markup (.header-avatar img). Called on every page load, and again
  // by profile.js right after a new photo is saved, so the header
  // updates immediately instead of only on the next navigation.
  const AVATAR_PHOTO_KEY = "vetra_vendor_profile_avatar";
  function applyCurrentVendorAvatar() {
    let saved = null;
    try {
      saved = localStorage.getItem(AVATAR_PHOTO_KEY);
    } catch (e) {
      /* localStorage unavailable (private mode, etc.) */
    }
    if (!saved) return;
    document.querySelectorAll(".header-avatar img").forEach((img) => {
      img.src = saved;
    });
  }

  function init() {
    wireSidebarToggle();
    wireSidebarCollapse();
    applyCurrentVendorAvatar();
  }

  return {
    wireSidebarToggle,
    wireSidebarCollapse,
    applyCurrentVendorAvatar,
    init,
  };
})();

document.addEventListener("DOMContentLoaded", () => VetraUI.init());
