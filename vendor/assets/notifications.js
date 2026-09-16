/* =========================================================
   VETRA — VENDOR NOTIFICATIONS (vendor/notifications.html, real backend)
   Same real GET/PATCH /api/notifications wiring as
   customer/assets/notifications.js — see that file's header comment.
   ========================================================= */

const VENDOR_NOTIF_TYPE_ICON_CLASS = {
  order: "",
  account: "accent",
  kyc: "accent",
  vendor_status: "accent",
  report: "accent",
};

function formatVendorNotifTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins > 1 ? "s" : ""} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "Yesterday" : `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

document.addEventListener("DOMContentLoaded", async () => {
  const list = document.querySelector(".notification-list");
  const markAllBtn = document.querySelector(".page-link");
  if (!list) return;

  async function load() {
    list.innerHTML = `<p class="vendor-products-empty">Loading…</p>`;
    let rows = [];
    try {
      rows = await VetraAPI.request("/notifications", { method: "GET", role: "vendor" });
    } catch (err) {
      list.innerHTML = `<p class="vendor-products-empty">Couldn't load notifications: ${err.message}</p>`;
      return;
    }
    if (!rows.length) {
      list.innerHTML = `<p class="vendor-products-empty">No notifications yet.</p>`;
      return;
    }
    list.innerHTML = rows
      .map(
        (n) => `
        <a class="notification-card${n.read_at ? "" : " unread"}" data-id="${n.id}" href="${n.link || "#"}" style="text-decoration: none; color: inherit;">
          <div class="notif-icon ${VENDOR_NOTIF_TYPE_ICON_CLASS[n.type] || ""}"></div>
          <div>
            <h3>${n.title}</h3>
            <p>${n.message}</p>
            <span>${formatVendorNotifTime(n.created_at)}</span>
          </div>
        </a>
      `
      )
      .join("");

    list.querySelectorAll(".notification-card.unread").forEach((card) => {
      card.addEventListener("click", () => {
        VetraAPI.request(`/notifications/${card.dataset.id}/read`, { method: "PATCH", role: "vendor" }).catch(() => {});
        card.classList.remove("unread");
        if (typeof VetraUI !== "undefined") VetraUI.updateNotificationBadge();
      });
    });
  }

  if (markAllBtn) {
    markAllBtn.addEventListener("click", async () => {
      try {
        await VetraAPI.request("/notifications/read-all", { method: "PATCH", role: "vendor" });
        list.querySelectorAll(".notification-card.unread").forEach((c) => c.classList.remove("unread"));
        if (typeof VetraUI !== "undefined") VetraUI.updateNotificationBadge();
      } catch (err) {
        /* silent — the list still reflects whatever state actually saved */
      }
    });
  }

  await load();
});
