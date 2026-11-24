/* =========================================================
   VETRA: shared notifications list (customer + vendor).
   Real GET/PATCH /api/notifications (backend/src/routes/
   notifications.routes.js). Used by customer/assets/notifications.js
   and vendor/assets/notifications.js, which only differ in the role
   they sign requests with and which badge updater they call.

   Read vs unread has to be obvious at a glance, so an unread card gets
   all of: a "New" group heading, an accent edge, a filled type icon, a
   bold title, and a dot; a read card is flat and muted. Styles live in
   ../notifications.css.
   ========================================================= */

const VetraNotifications = (() => {
  const svg = (paths) =>
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const ICONS = {
    order: svg('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>'),
    delivery: svg('<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
    account: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    login: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    kyc: svg('<path d="M12 3 20 6.5V12c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V6.5z"/><path d="m9 12 2 2 4-4"/>'),
    vendor: svg('<path d="M3 9 4.5 4h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>'),
    vendor_status: svg('<path d="M3 9 4.5 4h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>'),
    low_stock: svg('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    report: svg('<path d="M4 22V4a1 1 0 0 1 1-1h12l-2 4 2 4H5"/>'),
    ban: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
    contact: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    default: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  };

  // Tone sets the icon tile colour (see .notif-icon[data-tone] in notifications.css).
  const TONES = {
    order: "accent", delivery: "accent", kyc: "success", vendor: "accent", vendor_status: "accent",
    low_stock: "warning", report: "warning", ban: "danger", login: "neutral", account: "neutral", contact: "neutral",
  };

  // A notification link is only followed if it's a same-site relative
  // path or an https URL, never a javascript: or other scheme.
  function safeHref(link) {
    if (!link || link === "#") return null;
    const s = String(link).trim();
    if (/^https:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//")) return null;
    return s;
  }

  function card(n) {
    const esc = VetraAPI.escapeHtml;
    const unread = !n.read_at;
    const href = safeHref(n.link);
    const time = typeof formatRelativeTimeNG === "function" ? formatRelativeTimeNG(n.created_at) : "";
    const tag = href ? "a" : "div";
    const attrs = href ? `href="${esc(href)}"` : `role="button" tabindex="0"`;
    return `
      <${tag} class="notification-card${unread ? " unread" : " read"}" data-id="${esc(n.id)}" ${attrs}
        aria-label="${unread ? "Unread: " : ""}${esc(n.title || "Notification")}">
        <div class="notif-icon" data-tone="${TONES[n.type] || "neutral"}">${ICONS[n.type] || ICONS.default}</div>
        <div class="notif-body">
          <div class="notif-title-row">
            <h3>${esc(n.title || "")}</h3>
            ${unread ? '<span class="notif-dot" aria-hidden="true"></span>' : ""}
          </div>
          <p>${esc(n.message || "")}</p>
          <time class="notif-time" datetime="${esc(n.created_at || "")}">${esc(time)}</time>
        </div>
      </${tag}>`;
  }

  /**
   * @param {Object} opts
   * @param {"buyer"|"vendor"} opts.role
   * @param {string} opts.emptyClass - the app's own empty-state class
   * @param {Function} [opts.onBadgeChange] - refreshes the header bell count
   */
  function mount({ role, emptyClass, onBadgeChange }) {
    const list = document.querySelector(".notification-list");
    const markAllBtn = document.querySelector(".page-link");
    const header = document.querySelector(".page-header h1");
    if (!list) return;

    let summary = document.querySelector(".notif-summary");
    if (!summary && header) {
      summary = document.createElement("p");
      summary.className = "notif-summary";
      summary.setAttribute("aria-live", "polite");
      header.insertAdjacentElement("afterend", summary);
    }

    const badge = () => { if (typeof onBadgeChange === "function") onBadgeChange(); };
    const empty = (text) => `<p class="${emptyClass} notif-empty">${text}</p>`;

    function refreshSummary() {
      const count = list.querySelectorAll(".notification-card.unread").length;
      if (summary) summary.textContent = count ? `${count} unread` : "You're all caught up";
      if (markAllBtn) {
        markAllBtn.disabled = count === 0;
        markAllBtn.hidden = !list.querySelector(".notification-card");
      }
      // Drop the "New" group once nothing in it is unread any more.
      const newGroup = list.querySelector('[data-group="new"]');
      if (newGroup && !newGroup.querySelector(".notification-card.unread")) {
        const earlier = list.querySelector('[data-group="earlier"]');
        const cards = Array.from(newGroup.querySelectorAll(".notification-card"));
        if (earlier) {
          const body = earlier.querySelector(".notif-group-list");
          cards.reverse().forEach((c) => body.prepend(c));
          newGroup.remove();
        } else {
          newGroup.dataset.group = "earlier";
          newGroup.querySelector(".notif-group-label").textContent = "Earlier";
        }
      }
    }

    function markCardRead(cardEl) {
      cardEl.classList.remove("unread");
      cardEl.classList.add("read");
      cardEl.querySelector(".notif-dot")?.remove();
      const label = cardEl.getAttribute("aria-label") || "";
      cardEl.setAttribute("aria-label", label.replace(/^Unread: /, ""));
    }

    async function markRead(cardEl) {
      if (!cardEl.classList.contains("unread")) return;
      markCardRead(cardEl);
      refreshSummary();
      try {
        await VetraAPI.request(`/notifications/${encodeURIComponent(cardEl.dataset.id)}/read`, { method: "PATCH", role });
      } catch (e) {
        /* the list reloads from the server next visit either way */
      }
      badge();
    }

    list.addEventListener("click", async (e) => {
      const cardEl = e.target.closest(".notification-card");
      if (!cardEl) return;
      const href = cardEl.getAttribute("href");
      const wasUnread = cardEl.classList.contains("unread");
      if (!wasUnread || !href || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
        markRead(cardEl);
        return;
      }
      // Wait (briefly) for the read to save before leaving the page,
      // otherwise the navigation can cancel the request and the card
      // shows as unread again on the way back.
      e.preventDefault();
      await Promise.race([markRead(cardEl), new Promise((r) => setTimeout(r, 800))]);
      window.location.href = href;
    });
    list.addEventListener("keydown", (e) => {
      const cardEl = e.target.closest('.notification-card[role="button"]');
      if (cardEl && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        markRead(cardEl);
      }
    });

    if (markAllBtn) {
      markAllBtn.addEventListener("click", async () => {
        markAllBtn.disabled = true;
        try {
          await VetraAPI.request("/notifications/read-all", { method: "PATCH", role });
          list.querySelectorAll(".notification-card.unread").forEach(markCardRead);
          badge();
        } catch (err) {
          /* nothing changed server-side, so leave the cards as they are */
        }
        refreshSummary();
      });
    }

    async function load() {
      list.innerHTML = empty("Loading…");
      let rows;
      try {
        rows = await VetraAPI.request("/notifications", { method: "GET", role });
      } catch (err) {
        list.innerHTML = empty(`Couldn't load notifications: ${VetraAPI.escapeHtml(err.message)}`);
        if (summary) summary.textContent = "";
        if (markAllBtn) markAllBtn.hidden = true;
        return;
      }
      if (!rows.length) {
        list.innerHTML = `
          <div class="notif-empty-state">
            <div class="notif-icon" data-tone="neutral">${ICONS.default}</div>
            <h3>No notifications yet</h3>
            <p>Order updates, deliveries and account alerts will show up here.</p>
          </div>`;
        refreshSummary();
        return;
      }
      const unread = rows.filter((n) => !n.read_at);
      const read = rows.filter((n) => n.read_at);
      const group = (key, label, items) =>
        items.length
          ? `<section class="notif-group" data-group="${key}">
               <h2 class="notif-group-label">${label}</h2>
               <div class="notif-group-list">${items.map(card).join("")}</div>
             </section>`
          : "";
      list.innerHTML = group("new", "New", unread) + group("earlier", "Earlier", read);
      refreshSummary();
    }

    load();
  }

  return { mount };
})();
