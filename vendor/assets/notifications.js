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

// formatRelativeTimeNG (api-client.js) — Africa/Lagos always, and
// detailed past the hour mark ("3h 24m ago", not just "3 hours ago").

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
            <span>${formatRelativeTimeNG(n.created_at)}</span>
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
