/* =========================================================
   VETRA — VENDOR BUSINESS VERIFICATION (KYC)
   Page-specific script for vendor/profile.html only.

   Lets a vendor upload a valid ID + CAC certificate and enter
   their CAC registration number, then "submit for verification."
   Mirrors the file-preview pattern from assets/add-product.js
   (object URL preview, a remove button, a .has-media class).

   Submission state (status/cacNumber/file names/submittedAt) is
   saved to this browser's own localStorage — like the vendor
   profile photo pickers — so the closed/pending view survives a
   reload instead of resetting to "not submitted" every time. It
   is still a page-local mock: it does NOT write into the admin
   console's localStorage, and nothing here can ever *become*
   "rejected" on its own, since only an admin's real decision
   (admin/vendor-detail.html's Reject action, on the admin side's
   own separate seed data) can do that, and the two apps don't
   share state. The `rejected` branch below is fully implemented
   and correct, just unreachable from this page alone until a real
   backend lets admin's decision reach the vendor — see
   BACKEND_GUIDE.md §7 for the intended real flow.
   ========================================================= */

const KYC_STORAGE_KEY = "vetra_vendor_kyc_state";

function readKycState() {
  try {
    const raw = localStorage.getItem(KYC_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null; // localStorage unavailable (private mode, etc.)
  }
}

function writeKycState(kyc) {
  try {
    localStorage.setItem(KYC_STORAGE_KEY, JSON.stringify(kyc));
  } catch (e) {
    /* ignore write failures — the page still reflects the new state */
  }
}

function formatKycDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("kyc-form");
  if (!form) return;

  const statusBadge = document.getElementById("kyc-status-badge");
  const noteEl = document.getElementById("kyc-note");
  const submitBtn = document.getElementById("kyc-submit-btn");
  const cacNumberInput = document.getElementById("kyc-cac-number");

  const summary = document.getElementById("kyc-summary");
  const summaryCac = document.getElementById("kyc-summary-cac");
  const summarySubmitted = document.getElementById("kyc-summary-submitted");
  const summaryIdFile = document.getElementById("kyc-summary-id-file");
  const summaryCacFile = document.getElementById("kyc-summary-cac-file");
  const summaryNote = document.getElementById("kyc-summary-note");

  const STATUS_LABEL = {
    not_submitted: "Not submitted",
    pending: "Pending review",
    verified: "Verified",
    rejected: "Resubmission needed",
  };
  const STATUS_BADGE_CLASS = {
    not_submitted: "status-not-submitted",
    pending: "status-pending",
    verified: "", // default .profile-badge look is already the green "verified" style
    rejected: "status-rejected",
  };

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

  let kyc = readKycState() || {
    status: "not_submitted",
    cacNumber: null,
    idFileName: null,
    cacFileName: null,
    submittedAt: null,
    rejectionReason: null,
  };

  function applyKycStatus() {
    statusBadge.textContent = STATUS_LABEL[kyc.status] || kyc.status;
    statusBadge.className = "profile-badge";
    if (STATUS_BADGE_CLASS[kyc.status]) statusBadge.classList.add(STATUS_BADGE_CLASS[kyc.status]);

    const isClosed = kyc.status === "pending" || kyc.status === "verified";
    const needsResubmit = kyc.status === "rejected";

    // Closed panel: form hidden, read-only summary shown instead.
    // Open panel (not_submitted, or rejected-and-must-resubmit): form
    // visible; rejected additionally keeps the summary visible above it
    // so the vendor can see what they last submitted.
    form.hidden = isClosed;
    summary.hidden = !isClosed && !needsResubmit;

    if (isClosed || needsResubmit) {
      summaryCac.textContent = kyc.cacNumber || "—";
      summarySubmitted.textContent = formatKycDateTime(kyc.submittedAt);
      summaryIdFile.textContent = kyc.idFileName || "—";
      summaryCacFile.textContent = kyc.cacFileName || "—";
    }

    if (kyc.status === "pending") {
      summaryNote.style.color = "";
      summaryNote.textContent = "Submitted — Vetra usually reviews new documents within 24 hours.";
    } else if (kyc.status === "verified") {
      summaryNote.style.color = "";
      summaryNote.textContent = "Your business is verified — buyers can see your Verified Vendor badge.";
    } else if (needsResubmit) {
      summaryNote.style.color = "#b91c1c";
      summaryNote.textContent = kyc.rejectionReason
        ? `Rejected: ${kyc.rejectionReason} — update your documents below and resubmit.`
        : "Your documents were rejected — update them below and resubmit.";
    }

    submitBtn.textContent = needsResubmit ? "Resubmit for verification" : "Submit for verification";
    if (needsResubmit && kyc.cacNumber) cacNumberInput.value = kyc.cacNumber;
  }

  applyKycStatus();

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
    kyc = {
      status: "pending",
      cacNumber: cacNumberInput.value.trim(),
      idFileName: slots.id.file.name,
      cacFileName: slots.cac.file.name,
      submittedAt: new Date().toISOString(),
      rejectionReason: null,
    };
    writeKycState(kyc);

    noteEl.style.color = "";
    noteEl.textContent = "";
    applyKycStatus();
  });
});
