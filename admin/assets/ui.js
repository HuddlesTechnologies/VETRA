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

  // ---- Notification badges ----
  // A red count on each nav link with something waiting on an admin
  // (GET /api/admin/badges), refreshed every minute and whenever the tab
  // comes back into view. The activity count is what's new since this
  // admin last opened the activity log, remembered in this browser.
  const BADGE_POLL_MS = 60000;
  const ACTIVITY_SEEN_KEY = "vetra_admin_activity_seen_at";
  const BADGE_PAGES = {
    vendors: "vendors.html",
    reports: "reports.html",
    messages: "messages.html",
    deliveries: "deliveries.html",
    payments: "payments.html",
    activity: "activity.html",
  };
  const baseTitle = document.title;

  function activitySeenAt() {
    try {
      return localStorage.getItem(ACTIVITY_SEEN_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function markActivitySeen() {
    try {
      localStorage.setItem(ACTIVITY_SEEN_KEY, new Date().toISOString());
    } catch (e) {
      /* storage unavailable, the badge just won't clear across reloads */
    }
  }

  function setBadge(el, count) {
    let badge = el.querySelector(":scope > .nav-count-badge");
    if (!count) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-count-badge";
      el.appendChild(badge);
    }
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.setAttribute("aria-label", `${count} new`);
  }

  async function refreshBadges() {
    if (!VetraAPI.getToken("admin") || document.hidden) return;
    const onActivityPage = location.pathname.endsWith("/activity.html");
    if (onActivityPage || !activitySeenAt()) markActivitySeen();
    let counts;
    try {
      counts = await VetraAPI.request(
        `/admin/badges?activitySince=${encodeURIComponent(activitySeenAt())}`,
        { method: "GET", role: "admin" }
      );
    } catch (e) {
      return;
    }
    let total = 0;
    for (const [key, page] of Object.entries(BADGE_PAGES)) {
      const count = Number(counts[key] || 0);
      total += count;
      document
        .querySelectorAll(`.sidebar-link[href="${page}"], .nav-item[href="${page}"], .icon-btn[href="${page}"]`)
        .forEach((el) => setBadge(el, count));
    }
    document.title = total ? `(${total > 99 ? "99+" : total}) ${baseTitle}` : baseTitle;
  }

  function init() {
    VetraChrome.wireSidebarToggle();
    VetraChrome.wireSidebarCollapse();
    applyCurrentAdminAvatar();
    if (document.querySelector(".sidebar-nav")) {
      refreshBadges();
      setInterval(refreshBadges, BADGE_POLL_MS);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) refreshBadges();
      });
    }
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
      // Only the latest 3 show until the admin expands the list.
      const VISIBLE = 3;
      const rowHtml = (row, i) =>
        `<div class="ip-history-row"${i >= VISIBLE ? " data-extra hidden" : ""}><strong>${escapeHtml(row.ip_address)}</strong><span>${VetraAdmin.formatDateTime(row.occurred_at)}</span></div>`;
      const extra = rows.length - VISIBLE;
      target.innerHTML = rows.length
        ? `<div class="ip-history-list">${rows.map(rowHtml).join("")}</div>${
            extra > 0
              ? `<button type="button" class="see-more ip-history-toggle" aria-expanded="false" style="margin-top: 8px; background: none; border: 0; padding: 0; cursor: pointer;">Show ${extra} more</button>`
              : ""
          }`
        : `<p class="table-empty">No successful login IPs recorded yet.</p>`;
      const toggle = target.querySelector(".ip-history-toggle");
      toggle?.addEventListener("click", () => {
        const expand = toggle.getAttribute("aria-expanded") !== "true";
        target.querySelectorAll("[data-extra]").forEach((el) => (el.hidden = !expand));
        toggle.setAttribute("aria-expanded", String(expand));
        toggle.textContent = expand ? "Show less" : `Show ${extra} more`;
      });
    } catch (err) {
      target.innerHTML = `<p class="table-empty">Couldn't load login IP history.</p>`;
    }
  }

  // ---- Permanent ban panel (customer-detail / vendor-detail) ----
  // Ban status, the Ban / Lift ban button, and every other account that
  // shares an email, phone, device, ID, bank account or card with this
  // one (GET /api/admin/users/:id/ban). onChange re-renders the page.
  async function renderBanPanel(user, targetId, onChange) {
    const target = document.getElementById(targetId);
    if (!target) return;
    let data;
    try {
      data = await VetraAPI.request(`/admin/users/${user.id}/ban`, { method: "GET", role: "admin" });
    } catch (err) {
      target.innerHTML = `<p class="table-empty">Couldn't load ban details.</p>`;
      return;
    }
    const detailPage = (a) => (a.role === "vendor" ? `vendor-detail.html?id=${a.id}` : a.role === "buyer" ? `customer-detail.html?id=${a.id}` : null);
    const banLine = data.banned
      ? `<p class="ban-status is-banned"><strong>Permanently banned</strong>${data.ban.automatic ? " automatically (their ID matched a banned account)" : data.ban.bannedByName ? ` by ${escapeHtml(data.ban.bannedByName)}` : ""} on ${VetraAdmin.formatDateTime(data.ban.createdAt)}.${data.ban.reason ? `<br>Reason: ${escapeHtml(data.ban.reason)}` : ""}</p>`
      : `<p class="ban-status">Not banned. A permanent ban signs them out, blocks this account, and stops the same email, phone, devices, ID, CAC number, bank account and cards from being used on any new account.</p>`;
    let button = "";
    if (data.banned && typeof isSuperAdmin === "function" && isSuperAdmin()) {
      button = `<button type="button" class="btn-activate" data-ban-action="lift">Lift ban</button>`;
    } else if (!data.banned && typeof canModerate === "function" && canModerate()) {
      button = `<button type="button" class="btn-suspend" data-ban-action="ban">Ban permanently</button>`;
    }
    const linked = data.linked.length
      ? `<div class="ip-history-list">${data.linked
          .map((a) => {
            const href = detailPage(a);
            const name = `${escapeHtml(a.name)} <span class="badge ${escapeHtml(a.status)}">${escapeHtml(a.status)}</span>`;
            return `<div class="ip-history-row"><div>${href ? `<a href="${href}" style="color: inherit;"><strong>${name}</strong></a>` : `<strong>${name}</strong>`}
              <p class="cell-sub">${escapeHtml(a.role === "buyer" ? "customer" : a.role)} · ${escapeHtml(a.email)}</p></div>
              <span class="cell-sub">Same ${escapeHtml(a.shared.join(", "))}</span></div>`;
          })
          .join("")}</div>`
      : `<p class="table-empty">No other accounts share this account's details.</p>`;
    target.innerHTML = `
      ${banLine}
      ${button ? `<div class="table-actions" style="margin: 10px 0 18px;">${button}</div>` : ""}
      <h4 class="ban-linked-title">Linked accounts</h4>
      ${linked}`;

    target.querySelector("[data-ban-action]")?.addEventListener("click", (e) => {
      const action = e.currentTarget.dataset.banAction;
      if (action === "ban") {
        VetraModal.confirm({
          title: "Ban permanently?",
          bodyHtml: `<span class="confirm-modal-target">${escapeHtml(user.name)}</span> will be signed out and can never use this account again. Their email, phone number, devices, ID, CAC number, bank account and cards are blocked from any new account.${user.role === "vendor" ? " Their products are taken off the store." : ""} They'll get an email telling them.${data.linked.length ? `<br><br>${data.linked.length} linked account${data.linked.length > 1 ? "s are" : " is"} not banned by this; ban them separately if needed.` : ""}`,
          confirmLabel: "Ban permanently",
          danger: true,
          requireReason: true,
          onConfirm: async (reason) => {
            try {
              await VetraAPI.request(`/admin/users/${user.id}/ban`, { method: "POST", role: "admin", body: { reason } });
              onChange?.();
            } catch (err) {
              VetraModal.info({ title: "Couldn't ban account", bodyHtml: escapeHtml(err.message) });
            }
          },
        });
      } else {
        VetraModal.confirm({
          title: "Lift the ban?",
          bodyHtml: `<span class="confirm-modal-target">${escapeHtml(user.name)}</span>'s account goes back to how it was before the ban${user.role === "vendor" ? ", with their products relisted" : ""}, and their details are no longer blocked.`,
          confirmLabel: "Lift ban",
          onConfirm: async () => {
            try {
              await VetraAPI.request(`/admin/users/${user.id}/ban`, { method: "DELETE", role: "admin" });
              onChange?.();
            } catch (err) {
              VetraModal.info({ title: "Couldn't lift ban", bodyHtml: escapeHtml(err.message) });
            }
          },
        });
      }
    });
  }

  // ---- Devices card (customer-detail / vendor-detail) ----
  // Each browser the account has used, with a permanent Ban / Unban.
  // Moderators and Super Admins only; the routes enforce that too.
  async function renderDevices(userId, targetId) {
    const target = document.getElementById(targetId);
    if (!target) return;
    let rows;
    try {
      rows = await VetraAPI.request(`/admin/users/${userId}/devices`, { method: "GET", role: "admin" });
    } catch (err) {
      target.innerHTML = `<p class="table-empty">Couldn't load devices.</p>`;
      return;
    }
    if (!rows.length) {
      target.innerHTML = `<p class="table-empty">No devices recorded yet. A device is recorded the next time this account signs in or uses the app.</p>`;
      return;
    }
    const manage = typeof canModerate === "function" && canModerate();
    target.innerHTML = `<div class="ip-history-list">${rows
      .map(
        (d) => `
        <div class="ip-history-row device-row">
          <div>
            <strong>${escapeHtml(d.label)}</strong>
            ${d.banned ? `<span class="badge suspended" style="margin-left: 6px;">Banned</span>` : ""}
            <p class="cell-sub" style="margin-top: 2px;">Last used ${VetraAdmin.formatDateTime(d.lastSeenAt)}${d.lastIp ? ` from ${escapeHtml(d.lastIp)}` : ""}${
              d.otherAccounts ? ` · also used by ${d.otherAccounts} other account${d.otherAccounts > 1 ? "s" : ""}` : ""
            }</p>
            ${d.banned && d.banReason ? `<p class="cell-sub">Reason: ${escapeHtml(d.banReason)}</p>` : ""}
          </div>
          ${
            manage
              ? d.banned
                ? `<button type="button" class="btn-activate" data-device-action="unban" data-device="${escapeHtml(d.deviceId)}">Unban device</button>`
                : `<button type="button" class="btn-suspend" data-device-action="ban" data-device="${escapeHtml(d.deviceId)}">Ban device</button>`
              : ""
          }
        </div>`
      )
      .join("")}</div>`;

    target.onclick = (e) => {
      const btn = e.target.closest("[data-device-action]");
      if (!btn) return;
      const deviceId = btn.dataset.device;
      if (btn.dataset.deviceAction === "ban") {
        VetraModal.confirm({
          title: "Ban this device permanently?",
          bodyHtml: "Nobody will be able to sign in, sign up or shop on VETRA from this device, with any account, until it's unbanned. The account is also signed out everywhere.",
          confirmLabel: "Ban device",
          danger: true,
          showReason: true,
          onConfirm: async (reasonText) => {
            const reason = (reasonText || "").trim() || null;
            try {
              await VetraAPI.request(`/admin/devices/${encodeURIComponent(deviceId)}/ban`, {
                method: "POST",
                role: "admin",
                body: { userId, reason },
              });
              renderDevices(userId, targetId);
            } catch (err) {
              VetraModal.info({ title: "Couldn't ban device", bodyHtml: escapeHtml(err.message) });
            }
          },
        });
      } else {
        VetraModal.confirm({
          title: "Unban this device?",
          bodyHtml: "This device will be able to use VETRA again.",
          confirmLabel: "Unban device",
          onConfirm: async () => {
            try {
              await VetraAPI.request(`/admin/devices/${encodeURIComponent(deviceId)}/ban`, { method: "DELETE", role: "admin" });
              renderDevices(userId, targetId);
            } catch (err) {
              VetraModal.info({ title: "Couldn't unban device", bodyHtml: escapeHtml(err.message) });
            }
          },
        });
      }
    };
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
    renderDevices,
    renderBanPanel,
    applyCurrentAdminAvatar,
    refreshBadges,
  };
})();

document.addEventListener("DOMContentLoaded", () => AdminUI.init());
