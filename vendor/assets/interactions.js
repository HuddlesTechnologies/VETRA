/* =========================================================
   VETRA: Shared page interactions (vendor).

   Every vendor page's header, sidebar, and bottom-nav markup lives
   directly in each page's own HTML now (it used to be built at
   runtime by this file). This file only wires up behavior on
   elements that already exist in the DOM when the page loads:
     - the header's sidebar toggle and the floating reopen button
     - the sidebar's collapse (icon-only) chevron
   The header's support icon (.support-btn) opens Smartsupp live chat
   instead, see assets/support.js, shared with the customer side.
   ========================================================= */

// Shared by assets/orders.js and assets/dashboard.js (both load this file),
// was two byte-identical copies under different names
// (formatOrderTimestamp/formatDashboardOrderTimestamp) before consolidation.
function formatOrderTimestamp(iso) {
  if (!iso) return "";
  return formatDateTimeNG(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

const VetraUI = (() => {
  // ---- Require a real, signed-in vendor session ----
  // Unlike the customer app (which deliberately allows guest browsing,
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

  // wireSidebarToggle/wireSidebarCollapse/applyCurrentVendorAvatar all
  // now delegate to shared-ui.js's VetraChrome (same implementation
  // admin and customer use), kept as named functions here, not
  // inlined into init(), so VetraUI's returned object keeps the exact
  // same shape for anything that calls them directly.
  function wireSidebarToggle() {
    VetraChrome.wireSidebarToggle();
  }

  function wireSidebarCollapse() {
    VetraChrome.wireSidebarCollapse();
  }

  // ---- Reflect the real signed-in vendor's avatar in every page's
  // header, since it's the same header markup on every vendor page.
  // Reads the real session (cached from sign-in/signup, or the last
  // avatar upload, see vendor/assets/profile.js) instead of a
  // per-browser localStorage mock; a brand-new store with no avatarUrl
  // yet just keeps the default placeholder already in the HTML. Called
  // on every page load, and again by profile.js right after a new
  // photo is saved, so the header updates immediately instead of only
  // on the next navigation.
  function applyCurrentVendorAvatar() {
    VetraChrome.applyAvatar("vendor");
  }

  // Same badge pattern as customer/assets/interactions.js's
  // updateNotificationBadge(), real unread count from GET
  // /api/notifications/unread-count, applied to every page's bell icon.
  async function updateNotificationBadge() {
    if (typeof VetraAPI === "undefined" || !VetraAPI.getUser("vendor")) return;
    let count = 0;
    try {
      const data = await VetraAPI.request("/notifications/unread-count", { method: "GET", role: "vendor" });
      count = data.count;
    } catch (err) {
      return; // leave whatever badge state was already there on failure
    }
    document.querySelectorAll('a[href="notifications.html"].icon-btn').forEach((link) => {
      let badge = link.querySelector(".notif-count-badge");
      if (count > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "notif-count-badge";
          link.appendChild(badge);
        }
        badge.textContent = count > 99 ? "99+" : String(count);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  function init() {
    if (!requireVendorSession()) return;
    wireSidebarToggle();
    wireSidebarCollapse();
    applyCurrentVendorAvatar();
    updateNotificationBadge();
  }

  return {
    requireVendorSession,
    wireSidebarToggle,
    wireSidebarCollapse,
    applyCurrentVendorAvatar,
    updateNotificationBadge,
    init,
  };
})();

document.addEventListener("DOMContentLoaded", () => VetraUI.init());
