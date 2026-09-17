/* =========================================================
   VETRA — ADMIN SHARED UI (sidebar + confirm modal)

   wireSidebarToggle/Collapse mirror vendor/assets/interactions.js
   so the admin shell behaves identically to the vendor and
   customer app shells.

   AdminUI.confirm(...) drives the single reusable confirm
   modal (#confirm-modal) that customers.html, vendors.html and
   reports.html each include in their markup. It is the one
   place a destructive/administrative action (suspend, approve,
   reject, resolve, dismiss) gets a human "are you sure" step
   before VetraAdmin.* mutates state — every page-specific JS
   file (customers.js, vendors.js, reports.js) calls this
   instead of wiring its own modal.
   ========================================================= */

const AdminUI = (() => {
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

  // ---- Reusable confirm modal ----
  let activeOnConfirm = null;

  function getEls() {
    const reasonWrap = document.getElementById("confirm-modal-reason-wrap");
    return {
      overlay: document.getElementById("confirm-modal"),
      title: document.getElementById("confirm-modal-title"),
      body: document.getElementById("confirm-modal-body"),
      reasonWrap,
      reasonHint: reasonWrap ? reasonWrap.querySelector(".form-hint") : null,
      reasonError: reasonWrap ? getOrCreateReasonError(reasonWrap) : null,
      reason: document.getElementById("confirm-modal-reason"),
      confirmBtn: document.getElementById("confirm-modal-confirm"),
      cancelBtn: document.getElementById("confirm-modal-cancel"),
      closeBtn: document.getElementById("confirm-modal-close"),
    };
  }

  // Created once per page and cached on the wrap itself — every admin
  // page ships its own copy of #confirm-modal's markup with no error
  // element of its own, so this is added in JS instead of touching all
  // seven pages' HTML for one small validation message.
  function getOrCreateReasonError(reasonWrap) {
    let el = reasonWrap.querySelector(".confirm-modal-reason-error");
    if (!el) {
      el = document.createElement("p");
      el.className = "confirm-modal-reason-error";
      el.style.cssText = "margin: 6px 0 0; font-size: 12px; font-weight: 600; color: #e0475c;";
      el.hidden = true;
      reasonWrap.appendChild(el);
    }
    return el;
  }

  function closeModal() {
    const { overlay, reason } = getEls();
    if (!overlay) return;
    overlay.hidden = true;
    if (reason) reason.value = "";
    activeOnConfirm = null;
  }

  let activeRequireReason = false;

  /**
   * Open the shared confirm modal.
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.bodyHtml - HTML string, target name usually wrapped in .confirm-modal-target
   * @param {string} [opts.confirmLabel="Confirm"]
   * @param {boolean} [opts.danger=false] - red confirm button for destructive actions
   * @param {boolean} [opts.showReason=false] - show the reason textarea
   * @param {boolean} [opts.requireReason=false] - reject an empty reason instead of
   *   letting Confirm proceed — implies showReason. Use for a decision the recipient
   *   needs a real explanation for (a KYC rejection), not every showReason use.
   * @param {(reason:string) => void} opts.onConfirm
   */
  function confirm(opts) {
    const els = getEls();
    if (!els.overlay) {
      // Page didn't include the modal markup — fail safe to a native confirm.
      if (window.confirm(opts.title || "Are you sure?")) opts.onConfirm("");
      return;
    }
    els.title.textContent = opts.title || "Confirm action";
    els.body.innerHTML = opts.bodyHtml || "";
    els.reasonWrap.hidden = !(opts.showReason || opts.requireReason);
    if (els.reasonHint) {
      els.reasonHint.textContent = opts.requireReason ? "(required)" : "(optional, visible in the activity log)";
    }
    if (els.reasonError) els.reasonError.hidden = true;
    activeRequireReason = !!opts.requireReason;
    els.cancelBtn.hidden = false;
    els.confirmBtn.textContent = opts.confirmLabel || "Confirm";
    els.confirmBtn.className = "btn " + (opts.danger ? "btn-cancel" : "btn-save");
    if (opts.danger) {
      els.confirmBtn.style.background = "#e0475c";
      els.confirmBtn.style.color = "#fff";
    } else {
      els.confirmBtn.style.background = "";
      els.confirmBtn.style.color = "";
    }
    activeOnConfirm = opts.onConfirm;
    els.overlay.hidden = false;
    if (opts.requireReason && els.reason) els.reason.focus();
  }

  /**
   * Open the shared modal in "info" mode: a single value to show the admin
   * (a generated temp password, a verification code) with one "Done"
   * button and no reason field. Used instead of a plain alert() so the
   * value is easy to read/select and styled consistently with the rest of
   * the console — see .reveal-panel in style.css.
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.bodyHtml
   * @param {string} [opts.confirmLabel="Done"]
   */
  function info(opts) {
    const els = getEls();
    if (!els.overlay) {
      window.alert(opts.bodyHtml?.replace(/<[^>]+>/g, "") || opts.title || "");
      return;
    }
    els.title.textContent = opts.title || "Notice";
    els.body.innerHTML = opts.bodyHtml || "";
    els.reasonWrap.hidden = true;
    els.confirmBtn.textContent = opts.confirmLabel || "Done";
    els.confirmBtn.className = "btn btn-save";
    els.confirmBtn.style.background = "";
    els.confirmBtn.style.color = "";
    els.cancelBtn.hidden = true;
    activeOnConfirm = null;
    els.overlay.hidden = false;
  }

  function wireConfirmModal() {
    const els = getEls();
    if (!els.overlay) return;

    els.confirmBtn.addEventListener("click", () => {
      const reason = els.reason ? els.reason.value.trim() : "";
      if (activeRequireReason && !reason) {
        if (els.reasonError) {
          els.reasonError.textContent = "A reason is required.";
          els.reasonError.hidden = false;
        }
        if (els.reason) els.reason.focus();
        return;
      }
      const cb = activeOnConfirm;
      closeModal();
      if (cb) cb(reason);
    });
    els.cancelBtn.addEventListener("click", closeModal);
    els.closeBtn.addEventListener("click", closeModal);
    els.overlay.addEventListener("click", (e) => {
      if (e.target === els.overlay) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !els.overlay.hidden) closeModal();
    });
  }

  // ---- Reflect the real signed-in admin's avatar in every page's header,
  // since it's the same header markup on every admin page. Reads the real
  // session (cached from POST /api/auth/admin-signin or the last avatar
  // upload — see admin/assets/settings.js) instead of the old mock team
  // roster, which had no way to know about an admin created via the real
  // invite flow.
  function applyCurrentAdminAvatar() {
    if (typeof VetraAPI === "undefined") return;
    const me = VetraAPI.getUser("admin");
    if (!me || !me.avatarUrl) return;
    document.querySelectorAll(".header-avatar img").forEach((img) => {
      img.src = me.avatarUrl;
    });
  }

  function init() {
    wireSidebarToggle();
    wireSidebarCollapse();
    wireConfirmModal();
    applyCurrentAdminAvatar();
  }

  // ---- Shared activity-feed renderer (used by dashboard.js and activity.js) ----
  // a.message is already safe HTML (server escapes any user-controlled
  // substring before storing it — see backend/src/utils/escapeHtml.js).
  // a.actorName is NOT — it's a live join to users.name, a freeform
  // field with no character restrictions, so it must be escaped here.
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
  // button — omitted (or the viewer isn't a Super Admin) and no delete
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

  return { init, confirm, info, renderActivityFeed, applyCurrentAdminAvatar };
})();

document.addEventListener("DOMContentLoaded", () => AdminUI.init());
