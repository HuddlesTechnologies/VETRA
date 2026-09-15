/* =========================================================
   VETRA — VENDOR SHARED UI (confirm modal)

   VendorUI.confirm(...)/.info(...) drive the single reusable
   #confirm-modal markup each page that needs it includes
   (dashboard.html, products.html, profile.html — wherever a
   destructive or "hook this up" action used to fall back to a
   native confirm()/alert()). Same shape and markup contract as
   admin/assets/ui.js's AdminUI.confirm()/.info(), so a vendor
   sees the same in-app confirmation style as the admin console
   instead of the browser's own "this page says" dialog.
   ========================================================= */

const VendorUI = (() => {
  let activeOnConfirm = null;

  function getEls() {
    return {
      overlay: document.getElementById("confirm-modal"),
      title: document.getElementById("confirm-modal-title"),
      body: document.getElementById("confirm-modal-body"),
      confirmBtn: document.getElementById("confirm-modal-confirm"),
      cancelBtn: document.getElementById("confirm-modal-cancel"),
      closeBtn: document.getElementById("confirm-modal-close"),
    };
  }

  function closeModal() {
    const { overlay } = getEls();
    if (!overlay) return;
    overlay.hidden = true;
    activeOnConfirm = null;
  }

  /**
   * Open the shared confirm modal.
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.bodyHtml
   * @param {string} [opts.confirmLabel="Confirm"]
   * @param {boolean} [opts.danger=false] - red confirm button for destructive actions
   * @param {() => void} opts.onConfirm
   */
  function confirm(opts) {
    const els = getEls();
    if (!els.overlay) {
      // Page didn't include the modal markup — fail safe to a native confirm.
      if (window.confirm(opts.title || "Are you sure?")) opts.onConfirm();
      return;
    }
    els.title.textContent = opts.title || "Confirm action";
    els.body.innerHTML = opts.bodyHtml || "";
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
  }

  /**
   * Open the shared modal in "info" mode: a single message with one "Done"
   * button and no cancel — used instead of a plain alert().
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.bodyHtml
   * @param {string} [opts.confirmLabel="Done"]
   * @param {() => void} [opts.onClose] - runs after "Done" is clicked (e.g. a redirect that should wait until the user has actually seen the message)
   */
  function info(opts) {
    const els = getEls();
    if (!els.overlay) {
      window.alert(opts.bodyHtml?.replace(/<[^>]+>/g, "") || opts.title || "");
      if (opts.onClose) opts.onClose();
      return;
    }
    els.title.textContent = opts.title || "Notice";
    els.body.innerHTML = opts.bodyHtml || "";
    els.confirmBtn.textContent = opts.confirmLabel || "Done";
    els.confirmBtn.className = "btn btn-save";
    els.confirmBtn.style.background = "";
    els.confirmBtn.style.color = "";
    els.cancelBtn.hidden = true;
    activeOnConfirm = opts.onClose || null;
    els.overlay.hidden = false;
  }

  function wireConfirmModal() {
    const els = getEls();
    if (!els.overlay) return;

    els.confirmBtn.addEventListener("click", () => {
      const cb = activeOnConfirm;
      closeModal();
      if (cb) cb();
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

  // ---- Photo preview modal (avatar/cover photo save-or-cancel) ----
  // A large preview + full-size Save/Cancel buttons in a popup, instead
  // of two tiny icon-only buttons crowded onto the corner of the photo
  // itself — same idea as confirm()/info() above, just with an image.
  let activePhotoOnSave = null;
  let activePhotoOnCancel = null;

  function getPhotoEls() {
    return {
      overlay: document.getElementById("photo-preview-modal"),
      title: document.getElementById("photo-preview-title"),
      frame: document.getElementById("photo-preview-frame"),
      img: document.getElementById("photo-preview-img"),
      saveBtn: document.getElementById("photo-preview-save"),
      cancelBtn: document.getElementById("photo-preview-cancel"),
      closeBtn: document.getElementById("photo-preview-close"),
    };
  }

  function closePhotoModal(runCancel) {
    const { overlay } = getPhotoEls();
    if (!overlay) return;
    overlay.hidden = true;
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
    const els = getPhotoEls();
    if (!els.overlay) {
      // Page didn't include the modal markup — fail safe to a native confirm.
      if (window.confirm(opts.title || "Save this photo?")) opts.onSave();
      else if (opts.onCancel) opts.onCancel();
      return;
    }
    els.title.textContent = opts.title || "Update photo";
    els.img.src = opts.imageUrl;
    els.frame.classList.toggle("is-cover", opts.shape === "cover");
    els.frame.classList.toggle("is-avatar", opts.shape !== "cover");
    els.saveBtn.textContent = opts.saveLabel || "Save photo";
    activePhotoOnSave = opts.onSave;
    activePhotoOnCancel = opts.onCancel || null;
    els.overlay.hidden = false;
  }

  function wirePhotoPreviewModal() {
    const els = getPhotoEls();
    if (!els.overlay) return;

    els.saveBtn.addEventListener("click", () => {
      const cb = activePhotoOnSave;
      closePhotoModal(false);
      if (cb) cb();
    });
    els.cancelBtn.addEventListener("click", () => closePhotoModal(true));
    els.closeBtn.addEventListener("click", () => closePhotoModal(true));
    els.overlay.addEventListener("click", (e) => {
      if (e.target === els.overlay) closePhotoModal(true);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !els.overlay.hidden) closePhotoModal(true);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireConfirmModal();
    wirePhotoPreviewModal();
  });

  return { confirm, info, photoPreview };
})();
