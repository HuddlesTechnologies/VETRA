/* =========================================================
   VETRA: Shared app chrome (customer/vendor/admin).

   Was three near-identical implementations (CustomerUI, VendorUI,
   AdminUI each reimplementing confirm()/info()/the sidebar toggle),
   with the modal's own markup copy-pasted into 18 separate pages,
   which is exactly how admin/activity.html once shipped without that
   markup at all and silently fell back to a native confirm(). One
   shared implementation, self-mounting its own markup on first use
   (same pattern admin/assets/contact-change.js already used, just
   made the one copy instead of a fourth), removes both problems: the
   markup can't go missing, and a fix here reaches every app at once.

   `VetraModal`: confirm()/info()/photoPreview(), the union of every
   feature the three previous versions individually had (admin's
   optional reason field, customer's onCancel, vendor/customer's
   photoPreview). Every existing call site (AdminUI.confirm(...),
   VendorUI.info(...), CustomerUI.photoPreview(...), etc.) keeps
   working unchanged, see each app's own assets/ui.js, now a thin
   wrapper delegating here.

   `VetraChrome`: wireSidebarToggle()/wireSidebarCollapse() (verified
   byte-identical across all three apps) and applyAvatar(role) (same
   body, just a different VetraAPI.getUser(role) argument per app).
   ========================================================= */

const VetraModal = (() => {
  let els = null;
  let photoEls = null;
  let activeOnConfirm = null;
  let activeOnCancel = null;
  let activeRequireReason = false;
  let activePhotoOnSave = null;
  let activePhotoOnCancel = null;

  function mountConfirmModal() {
    if (els) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="modal-overlay confirm-modal" id="confirm-modal" hidden>
        <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
          <div class="modal-header">
            <h2 id="confirm-modal-title">Confirm action</h2>
            <button type="button" class="modal-close-btn" id="confirm-modal-close" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <p class="confirm-modal-body" id="confirm-modal-body"></p>
            <div class="form-group full" id="confirm-modal-reason-wrap" hidden>
              <label class="form-label" for="confirm-modal-reason">Reason <span class="form-hint">(optional, visible in the activity log)</span></label>
              <textarea class="form-textarea" id="confirm-modal-reason" placeholder="e.g. Repeated chargeback disputes"></textarea>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-cancel" id="confirm-modal-cancel">Cancel</button>
              <button type="button" class="btn btn-save" id="confirm-modal-confirm">Confirm</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap.firstElementChild);

    const reasonWrap = document.getElementById("confirm-modal-reason-wrap");
    els = {
      overlay: document.getElementById("confirm-modal"),
      title: document.getElementById("confirm-modal-title"),
      body: document.getElementById("confirm-modal-body"),
      reasonWrap,
      reasonHint: reasonWrap.querySelector(".form-hint"),
      reasonError: getOrCreateReasonError(reasonWrap),
      reason: document.getElementById("confirm-modal-reason"),
      confirmBtn: document.getElementById("confirm-modal-confirm"),
      cancelBtn: document.getElementById("confirm-modal-cancel"),
      closeBtn: document.getElementById("confirm-modal-close"),
    };
    wireConfirmModal();
  }

  // Admin's reason-required validation needs an error line the shared
  // markup doesn't otherwise have, created once and cached on the
  // wrap itself, same as the pre-consolidation admin/assets/ui.js did.
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

  // `runCancel` distinguishes a dismiss (Cancel/✕/overlay/Escape,
  // fires opts.onCancel when given) from the confirm button's own
  // close, which already runs opts.onConfirm itself right after this.
  function closeModal(runCancel) {
    if (!els) return;
    els.overlay.hidden = true;
    if (els.reason) els.reason.value = "";
    const cancelCb = activeOnCancel;
    activeOnConfirm = null;
    activeOnCancel = null;
    if (runCancel && cancelCb) cancelCb();
  }

  /**
   * Open the shared confirm modal.
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.bodyHtml - HTML string, target name usually wrapped in .confirm-modal-target
   * @param {string} [opts.confirmLabel="Confirm"]
   * @param {boolean} [opts.danger=false] - red confirm button for destructive actions
   * @param {boolean} [opts.showReason=false] - show the reason textarea
   * @param {boolean} [opts.requireReason=false] - reject an empty reason instead of
   *   letting Confirm proceed, implies showReason.
   * @param {(reason: string) => void} opts.onConfirm - always called with the reason
   *   (empty string when no reason field is shown), existing callers that declare
   *   onConfirm with no parameters simply ignore it, so this is backward compatible.
   * @param {() => void} [opts.onCancel] - runs when the modal is dismissed instead of confirmed
   */
  function confirm(opts) {
    mountConfirmModal();
    if (!els.overlay) {
      if (window.confirm(opts.title || "Are you sure?")) opts.onConfirm("");
      else if (opts.onCancel) opts.onCancel();
      return;
    }
    els.title.textContent = opts.title || "Confirm action";
    els.body.innerHTML = opts.bodyHtml || "";
    els.reasonWrap.hidden = !(opts.showReason || opts.requireReason);
    els.reasonHint.textContent = opts.requireReason ? "(required)" : "(optional, visible in the activity log)";
    els.reasonError.hidden = true;
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
    activeOnCancel = opts.onCancel || null;
    els.overlay.hidden = false;
    if (opts.requireReason) els.reason.focus();
  }

  /**
   * Open the shared modal in "info" mode: a single message with one "Done"
   * button and no cancel, used instead of a plain alert().
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.bodyHtml
   * @param {string} [opts.confirmLabel="Done"]
   * @param {() => void} [opts.onClose] - runs after "Done" is clicked
   */
  function info(opts) {
    mountConfirmModal();
    if (!els.overlay) {
      window.alert(opts.bodyHtml?.replace(/<[^>]+>/g, "") || opts.title || "");
      if (opts.onClose) opts.onClose();
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
    activeOnConfirm = () => { if (opts.onClose) opts.onClose(); };
    activeOnCancel = null;
    els.overlay.hidden = false;
  }

  function wireConfirmModal() {
    els.confirmBtn.addEventListener("click", () => {
      const reason = els.reason ? els.reason.value.trim() : "";
      if (activeRequireReason && !reason) {
        els.reasonError.textContent = "A reason is required.";
        els.reasonError.hidden = false;
        els.reason.focus();
        return;
      }
      const cb = activeOnConfirm;
      closeModal(false);
      if (cb) cb(reason);
    });
    els.cancelBtn.addEventListener("click", () => closeModal(true));
    els.closeBtn.addEventListener("click", () => closeModal(true));
    els.overlay.addEventListener("click", (e) => {
      if (e.target === els.overlay) closeModal(true);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !els.overlay.hidden) closeModal(true);
    });
  }

  // ---- Photo preview modal (avatar/cover photo save-or-cancel) ----
  function mountPhotoModal() {
    if (photoEls) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="modal-overlay" id="photo-preview-modal" hidden>
        <div class="modal-panel">
          <div class="modal-header">
            <h2 id="photo-preview-title">Update photo</h2>
            <button type="button" class="modal-close-btn" id="photo-preview-close" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <div class="photo-preview-frame is-avatar" id="photo-preview-frame">
              <img id="photo-preview-img" alt="" />
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-cancel" id="photo-preview-cancel">Cancel</button>
              <button type="button" class="btn btn-save" id="photo-preview-save">Save photo</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap.firstElementChild);

    photoEls = {
      overlay: document.getElementById("photo-preview-modal"),
      title: document.getElementById("photo-preview-title"),
      frame: document.getElementById("photo-preview-frame"),
      img: document.getElementById("photo-preview-img"),
      saveBtn: document.getElementById("photo-preview-save"),
      cancelBtn: document.getElementById("photo-preview-cancel"),
      closeBtn: document.getElementById("photo-preview-close"),
    };
    wirePhotoPreviewModal();
  }

  function closePhotoModal(runCancel) {
    if (!photoEls) return;
    photoEls.overlay.hidden = true;
    const cb = activePhotoOnCancel;
    activePhotoOnSave = null;
    activePhotoOnCancel = null;
    if (runCancel && cb) cb();
  }

  /**
   * Open the shared photo-preview modal.
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.imageUrl - object URL or data URL to preview
   * @param {"avatar"|"cover"} [opts.shape="avatar"]
   * @param {string} [opts.saveLabel="Save photo"]
   * @param {() => void} opts.onSave
   * @param {() => void} [opts.onCancel]
   */
  function photoPreview(opts) {
    mountPhotoModal();
    if (!photoEls.overlay) {
      if (window.confirm(opts.title || "Save this photo?")) opts.onSave();
      else if (opts.onCancel) opts.onCancel();
      return;
    }
    photoEls.title.textContent = opts.title || "Update photo";
    photoEls.img.src = opts.imageUrl;
    photoEls.frame.classList.toggle("is-cover", opts.shape === "cover");
    photoEls.frame.classList.toggle("is-avatar", opts.shape !== "cover");
    photoEls.saveBtn.textContent = opts.saveLabel || "Save photo";
    activePhotoOnSave = opts.onSave;
    activePhotoOnCancel = opts.onCancel || null;
    photoEls.overlay.hidden = false;
  }

  function wirePhotoPreviewModal() {
    photoEls.saveBtn.addEventListener("click", () => {
      const cb = activePhotoOnSave;
      closePhotoModal(false);
      if (cb) cb();
    });
    photoEls.cancelBtn.addEventListener("click", () => closePhotoModal(true));
    photoEls.closeBtn.addEventListener("click", () => closePhotoModal(true));
    photoEls.overlay.addEventListener("click", (e) => {
      if (e.target === photoEls.overlay) closePhotoModal(true);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !photoEls.overlay.hidden) closePhotoModal(true);
    });
  }

  // ---- Low-level dismissal wiring, for a page's own bespoke modal
  // (e.g. admin/assets/contact-change.js's multi-field email/phone
  // change flow) that needs its own body content but shouldn't have to
  // reimplement "cancel/✕/overlay-click/Escape all close this" too. ----
  function wireDismissal({ overlay, cancelBtn, closeBtn, onDismiss }) {
    if (cancelBtn) cancelBtn.addEventListener("click", onDismiss);
    if (closeBtn) closeBtn.addEventListener("click", onDismiss);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) onDismiss();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) onDismiss();
    });
  }

  return { confirm, info, photoPreview, wireDismissal };
})();

const VetraChrome = (() => {
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

  // role: "admin" | "vendor" | "buyer" (customer accounts are role
  // "buyer" in the token/session shape, see api-client.js).
  function applyAvatar(role) {
    if (typeof VetraAPI === "undefined") return;
    const me = VetraAPI.getUser(role);
    if (!me || !me.avatarUrl) return;
    document.querySelectorAll(".header-avatar img").forEach((img) => {
      img.src = me.avatarUrl;
    });
  }

  return { wireSidebarToggle, wireSidebarCollapse, applyAvatar };
})();
