/* =========================================================
   VETRA: Admin shared UI (sidebar, confirm modal, activity feed).

   confirm()/info()/the sidebar toggle now delegate to shared-ui.js
   (VetraModal/VetraChrome), the same implementation vendor and
   customer use, instead of each app reimplementing it and each page
   carrying its own copy of the modal markup. AdminUI keeps its own
   API shape (confirm/info/etc. below) unchanged, so every existing
   caller (customers.js, vendors.js, dashboard.js, reports.js,
   customer-detail.js, vendor-detail.js, settings.js, activity.js)
   needs zero changes. What's genuinely admin-specific, the activity
   feed renderer and the login-IP-history renderer, real business
   logic rather than generic chrome, stays here.
   ========================================================= */

const AdminUI = (() => {
  // ---- Reflect the real signed-in admin's avatar in every page's header,
  // since it's the same header markup on every admin page. Reads the real
  // session (cached from POST /api/auth/admin-signin or the last avatar
  // upload, see admin/assets/settings.js) instead of the old mock team
  // roster, which had no way to know about an admin created via the real
  // invite flow.
  function applyCurrentAdminAvatar() {
    VetraChrome.applyAvatar("admin");
  }

  function init() {
    VetraChrome.wireSidebarToggle();
    VetraChrome.wireSidebarCollapse();
    applyCurrentAdminAvatar();
  }

  // ---- Shared activity-feed renderer (used by dashboard.js and activity.js) ----
  // a.message is already safe HTML (server escapes any user-controlled
  // substring before storing it, see backend/src/utils/escapeHtml.js).
  // a.actorName is NOT, it's a live join to users.name, a freeform
  // field with no character restrictions, so it must be escaped here.
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function renderIpHistory(userId, targetId) {
    const target = document.getElementById(targetId);
    if (!target) return;
    try {
      const rows = await VetraAPI.request(`/admin/users/${userId}/ip-history`, { method: "GET", role: "admin" });
      // Its own row shape, not .activity-item (that's a 3-column grid built
      // for an icon + message + trailing time, this is just two values,
      // which used to get force-fit into that grid's 34px icon column and
      // wide message column, squeezing the IP address and misaligning
      // everything).
      target.innerHTML = rows.length
        ? `<div class="ip-history-list">${rows
            .map(
              (row) => `<div class="ip-history-row"><strong>${escapeHtml(row.ip_address)}</strong><span>${VetraAdmin.formatDateTime(row.occurred_at)}</span></div>`
            )
            .join("")}</div>`
        : `<p class="table-empty">No successful login IPs recorded yet.</p>`;
    } catch (err) {
      target.innerHTML = `<p class="table-empty">Couldn't load login IP history.</p>`;
    }
  }

  function activityDotClass(type) {
    if (type === "account" || type === "report") return "warn";
    if (type === "vendor") return "good";
    return "";
  }

  function activityIcon(type) {
    switch (type) {
      case "account":
        return '<circle cx="12" cy="12" r="10"></circle><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"></line>';
      case "vendor":
        return '<path d="M20 6 9 17l-5-5"></path>';
      case "report":
        return '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="4"></line>';
      case "order":
        return '<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"></path>';
      case "login":
        return '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line>';
      default:
        return '<path d="M3 12h4l2 8 4-16 2 8h4"></path>';
    }
  }

  // onDelete(id): called when a Super Admin clicks one entry's delete
  // button, omitted (or the viewer isn't a Super Admin) and no delete
  // button renders at all, same view-vs-manage split as everywhere
  // else a destructive admin-team/settings action is gated.
  function renderActivityFeed(container, entries, onDelete) {
    if (!container) return;
    if (!entries.length) {
      container.innerHTML = `<p class="table-empty">No activity to show.</p>`;
      return;
    }
    const canDelete = typeof onDelete === "function" && typeof isSuperAdmin === "function" && isSuperAdmin();
    container.innerHTML = entries
      .map(
        (a) => `
      <div class="activity-item" data-id="${a.id || ""}">
        <span class="activity-dot ${activityDotClass(a.type)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${activityIcon(a.type)}</svg>
        </span>
        <div class="activity-text">
          <p>${a.message}</p>
          <span class="activity-type-tag">${a.type}</span>${
            a.actorName ? ` · <span class="activity-actor">by ${escapeHtml(a.actorName)}</span>` : ""
          }
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="activity-time">${VetraAdmin.timeAgo(a.time)}</span>
          ${canDelete ? `<button type="button" class="modal-close-btn" data-action="delete-activity" aria-label="Delete this entry" title="Delete this entry" style="width: 22px; height: 22px; font-size: 11px;">✕</button>` : ""}
        </div>
      </div>
    `
      )
      .join("");

    // Reassigning .onclick (rather than addEventListener) so repeated
    // renders of the same container never stack up duplicate listeners.
    if (canDelete) {
      container.onclick = (e) => {
        const btn = e.target.closest('[data-action="delete-activity"]');
        if (!btn) return;
        const id = btn.closest("[data-id]")?.dataset.id;
        if (id) onDelete(id);
      };
    }
  }

  return {
    init,
    confirm: VetraModal.confirm,
    info: VetraModal.info,
    renderActivityFeed,
    renderIpHistory,
    applyCurrentAdminAvatar,
  };
})();

document.addEventListener("DOMContentLoaded", () => AdminUI.init());
