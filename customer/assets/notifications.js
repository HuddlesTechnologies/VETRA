/* =========================================================
   VETRA — CUSTOMER NOTIFICATIONS (customer/notifications.html, real backend)
   Real GET/PATCH /api/notifications (backend/src/routes/
   notifications.routes.js) — replacing three permanently hard-coded
   cards with no data behind them at all. Clicking an unread card marks
   it read (matches the old markup's one clickable card) before
   following its link; "Mark all read" hits the real bulk endpoint.
   ========================================================= */

const NOTIF_TYPE_ICON_CLASS = {
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
    list.innerHTML = `<p class="products-empty-state">Loading…</p>`;
    let rows = [];
    try {
      rows = await VetraAPI.request("/notifications", { method: "GET", role: "buyer" });
    } catch (err) {
      list.innerHTML = `<p class="products-empty-state">Couldn't load notifications: ${err.message}</p>`;
      return;
    }
    if (!rows.length) {
      list.innerHTML = `<p class="products-empty-state">No notifications yet.</p>`;
      return;
    }
    list.innerHTML = rows
      .map(
        (n) => `
        <a class="notification-card${n.read_at ? "" : " unread"}" data-id="${n.id}" href="${n.link || "#"}" style="text-decoration: none; color: inherit;">
          <div class="notif-icon ${NOTIF_TYPE_ICON_CLASS[n.type] || ""}"></div>
          <div>
            <h3>${VetraAPI.escapeHtml(n.title || "")}</h3>
            <p>${VetraAPI.escapeHtml(n.message || "")}</p>
            <span>${formatRelativeTimeNG(n.created_at)}</span>
          </div>
        </a>
      `
      )
      .join("");

    list.querySelectorAll(".notification-card.unread").forEach((card) => {
      card.addEventListener("click", () => {
        VetraAPI.request(`/notifications/${card.dataset.id}/read`, { method: "PATCH", role: "buyer" }).catch(() => {});
        card.classList.remove("unread");
        if (typeof Vetra !== "undefined") Vetra.updateNotificationBadge();
      });
    });
  }

  if (markAllBtn) {
    markAllBtn.addEventListener("click", async () => {
      try {
        await VetraAPI.request("/notifications/read-all", { method: "PATCH", role: "buyer" });
        list.querySelectorAll(".notification-card.unread").forEach((c) => c.classList.remove("unread"));
        if (typeof Vetra !== "undefined") Vetra.updateNotificationBadge();
      } catch (err) {
        /* silent — the list still reflects whatever state actually saved */
      }
    });
  }

  await load();
});
