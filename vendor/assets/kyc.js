/* =========================================================
   VETRA — VENDOR BUSINESS VERIFICATION (KYC)
   Page-specific script for vendor/profile.html only.

   Lets a vendor upload a valid ID + CAC certificate and enter
   their CAC registration number, then "submit for verification."
   Mirrors the file-preview pattern from assets/add-product.js
   (object URL preview, a remove button, a .has-media class) but
   is otherwise a self-contained, page-local mock — like the rest
   of this app, nothing here persists past a reload, and it does
   NOT write into the admin console's localStorage. What an admin
   sees on a vendor's KYC (admin/vendor-detail.html) is separate
   seed data representing "documents already reviewed" — the two
   are deliberately not wired together, same as every other place
   this app and the admin console don't share state.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("kyc-form");
  if (!form) return;

  const statusBadge = document.getElementById("kyc-status-badge");
  const noteEl = document.getElementById("kyc-note");
  const submitBtn = document.getElementById("kyc-submit-btn");
  const cacNumberInput = document.getElementById("kyc-cac-number");

  statusBadge.classList.add("status-not-submitted");

  const slots = {
    id: { el: document.getElementById("kyc-id-slot"), input: document.getElementById("kyc-id-input"), file: null, objectUrl: null },
    cac: { el: document.getElementById("kyc-cac-slot"), input: document.getElementById("kyc-cac-input"), file: null, objectUrl: null },
  };

  function setPreview(key, file) {
    const slot = slots[key];
    if (slot.objectUrl) {
      URL.revokeObjectURL(slot.objectUrl);
      slot.objectUrl = null;
    }
    slot.el.querySelector(".media-preview-img")?.remove();
    slot.el.querySelector(".media-remove-btn")?.remove();
    slot.el.querySelector(".media-file-name")?.remove();
    slot.file = file;

    if (!file) {
      slot.el.classList.remove("has-media");
      return;
    }

    if (file.type.startsWith("image/")) {
      slot.objectUrl = URL.createObjectURL(file);
      const img = document.createElement("img");
      img.className = "media-preview-img";
      img.src = slot.objectUrl;
      img.alt = "";
      slot.el.appendChild(img);
    } else {
      // Non-image (e.g. a CAC certificate uploaded as a PDF) — nothing to
      // preview visually, so just show the filename instead.
      const name = document.createElement("span");
      name.className = "media-file-name";
      name.textContent = file.name;
      name.style.cssText = "font-size: 11px; font-weight: 700; text-align: center; padding: 0 6px; word-break: break-word;";
      slot.el.appendChild(name);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "media-remove-btn";
    removeBtn.setAttribute("aria-label", "Remove file");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      slot.input.value = "";
      setPreview(key, null);
    });
    slot.el.appendChild(removeBtn);

    slot.el.classList.add("has-media");
  }

  Object.keys(slots).forEach((key) => {
    slots[key].input.addEventListener("change", () => {
      const file = slots[key].input.files && slots[key].input.files[0];
      if (file) setPreview(key, file);
    });
  });

  function setLocked(locked) {
    cacNumberInput.readOnly = locked;
    Object.values(slots).forEach((s) => {
      s.input.disabled = locked;
      s.el.classList.toggle("is-locked", locked);
    });
    submitBtn.hidden = locked;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    if (!cacNumberInput.value.trim() || !slots.id.file || !slots.cac.file) {
      noteEl.textContent = "Enter your CAC number and upload both documents before submitting.";
      noteEl.style.color = "#b91c1c";
      return;
    }

    // TODO: replace with a real submit-for-review API call (multipart
    // upload of both files + the CAC number) once a backend exists — see
    // BACKEND_GUIDE.md §7 step 8 (file uploads) and the `report_evidence`-
    // style pattern already used for vendor/assets/reports.js's evidence
    // submission.
    statusBadge.textContent = "Pending review";
    statusBadge.classList.remove("status-not-submitted");
    statusBadge.classList.add("status-pending");
    noteEl.style.color = "";
    noteEl.textContent = "Submitted — Vetra usually reviews new documents within 24 hours.";
    setLocked(true);
  });
});
