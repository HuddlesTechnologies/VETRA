/* =========================================================
   VETRA: Vendor business verification (KYC), real backend.
   Page-specific script for vendor/profile.html only.

   Lets a vendor upload a valid ID + CAC certificate and enter their
   CAC registration number, then submit for verification. Mirrors the
   file-preview pattern from assets/add-product.js (object URL
   preview, a remove button, a .has-media class) for the picker UI,
   but persistence is now real: both files upload via POST
   /api/uploads (stored privately on the server), then GET/POST /api/vendors/me/kyc
   (backend/src/routes/vendors.routes.js) stores/reads the submission,
   replacing the old per-browser localStorage mock. Admin's real
   Verify/Reject decision (admin/assets/vendor-detail.js, PATCH
   /api/admin/vendors/:id/kyc) now actually reaches this page on
   reload, since both sides read the same vendor_kyc table.
   ========================================================= */

function formatKycDateTime(iso) {
  return formatDateTimeNG(iso, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

document.addEventListener("DOMContentLoaded", async () => {
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
  const identityType = document.getElementById("kyc-identity-type");
  const identityNumber = document.getElementById("kyc-identity-number");
  const dobGroup = document.getElementById("kyc-dob-group");
  const dobInput = document.getElementById("kyc-date-of-birth");
  const providerStatus = document.getElementById("kyc-provider-status");

  const NUMBER_HINT = {
    nin: "11-digit NIN",
    bvn: "11-digit BVN",
    drivers_license: "e.g. ABC12345AA01",
  };
  identityType.addEventListener("change", () => {
    const isLicence = identityType.value === "drivers_license";
    dobGroup.hidden = !isLicence;
    dobInput.required = isLicence;
    identityNumber.placeholder = NUMBER_HINT[identityType.value] || "";
    identityNumber.inputMode = isLicence ? "text" : "numeric";
  });

  const STATUS_LABEL = {
    not_submitted: "Not submitted",
    pending: "Pending review",
    manual_review: "Manual review needed",
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
      // Non-image (e.g. a CAC certificate uploaded as a PDF), nothing to
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

  // Same rules as POST /api/uploads for the kyc folder: any document or
  // photo, never a video, up to 50MB.
  const MAX_KYC_BYTES = 50 * 1024 * 1024;
  function kycFileProblem(file) {
    if (/^video\//i.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp|wmv|flv|mpe?g)$/i.test(file.name)) {
      return "Videos can't be used for verification. Upload a photo, scan or document instead.";
    }
    if (file.size > MAX_KYC_BYTES) return "That file is over 50MB. Upload a smaller copy.";
    return null;
  }

  Object.keys(slots).forEach((key) => {
    slots[key].input.addEventListener("change", () => {
      const file = slots[key].input.files && slots[key].input.files[0];
      if (!file) return;
      const problem = kycFileProblem(file);
      if (problem) {
        slots[key].input.value = "";
        noteEl.style.color = "var(--c-red)";
        noteEl.textContent = problem;
        return;
      }
      noteEl.textContent = "";
      setPreview(key, file);
    });
  });

  let kyc = { status: "not_submitted", cacNumber: null, idDocumentUrl: null, cacDocumentUrl: null, submittedAt: null, rejectionReason: null };

  function renderProviderStatus() {
    const identity = kyc.identityProviderStatus;
    const cac = kyc.cacProviderStatus;
    if (!identity && !cac) {
      providerStatus.textContent = "No automatic verification has been completed yet.";
      return;
    }
    const identityLabel = identity === "verified" ? "Identity verified" : identity === "failed" ? "Identity not verified" : "Identity not checked";
    const cacLabel = cac === "verified" ? "CAC verified" : cac === "failed" ? "CAC not verified" : "CAC not checked";
    providerStatus.textContent = `${identityLabel} · ${cacLabel}`;
    providerStatus.style.color = identity === "verified" && cac === "verified" ? "var(--c-green)" : "var(--c-orange)";
  }

  function applyKycStatus() {
    statusBadge.textContent = STATUS_LABEL[kyc.status] || kyc.status;
    statusBadge.className = "profile-badge";
    if (STATUS_BADGE_CLASS[kyc.status]) statusBadge.classList.add(STATUS_BADGE_CLASS[kyc.status]);

    // Pending and manual review are both "in review": the form stays
    // closed until an admin decides, and the server refuses a resubmission.
    const inReview = kyc.status === "pending" || kyc.status === "manual_review";
    const isClosed = inReview || kyc.status === "verified";
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
      summaryIdFile.innerHTML = kyc.idDocumentUrl
        ? `<a href="${kyc.idDocumentUrl}" target="_blank" rel="noopener noreferrer">View uploaded ID</a>`
        : "—";
      summaryCacFile.innerHTML = kyc.cacDocumentUrl
        ? `<a href="${kyc.cacDocumentUrl}" target="_blank" rel="noopener noreferrer">View uploaded CAC document</a>`
        : "—";
    }

    if (kyc.status === "pending") {
      summaryNote.style.color = "";
      summaryNote.textContent = "Your documents are in review, VETRA usually reviews them within 24 hours. You can't submit again until the review is done.";
    } else if (kyc.status === "manual_review") {
      summaryNote.style.color = "var(--c-orange)";
      summaryNote.textContent = "Your documents are being reviewed by the VETRA team. You can't submit again while the review is in progress, we'll notify you as soon as it's done.";
    } else if (kyc.status === "verified") {
      summaryNote.style.color = "";
      summaryNote.textContent = "Your business is verified, buyers can see your Verified Vendor badge.";
    } else if (needsResubmit) {
      summaryNote.style.color = "var(--c-red)";
      summaryNote.textContent = kyc.rejectionReason
        ? `Rejected: ${kyc.rejectionReason}, update your documents below and resubmit.`
        : "Your documents were rejected, update them below and resubmit.";
    }

    submitBtn.textContent = needsResubmit ? "Resubmit for verification" : "Submit for verification";
    if (needsResubmit && kyc.cacNumber) cacNumberInput.value = kyc.cacNumber;
    renderProviderStatus();
  }

  try {
    kyc = await VetraAPI.request("/vendors/me/kyc", { method: "GET", role: "vendor" });
  } catch (err) {
    console.error("Failed to load KYC status:", err);
  }
  applyKycStatus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!cacNumberInput.value.trim() || !identityNumber.value.trim() || !slots.id.file || !slots.cac.file) {
      noteEl.textContent = "Enter your identity number and CAC number, then upload both documents before submitting.";
      noteEl.style.color = "var(--c-red)";
      return;
    }

    noteEl.style.color = "";
    noteEl.textContent = "";
    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = "Uploading and verifying…";

    try {
      const [idDocumentUrl, cacDocumentUrl] = await Promise.all([
        VetraAPI.uploadFile(slots.id.file, { role: "vendor", folder: "kyc" }),
        VetraAPI.uploadFile(slots.cac.file, { role: "vendor", folder: "kyc" }),
      ]);
      const cacNumber = cacNumberInput.value.trim();
      await VetraAPI.request("/vendors/me/kyc", {
        method: "POST",
        role: "vendor",
        body: { cacNumber, idDocumentUrl, cacDocumentUrl },
      });
      let verification;
      try {
        verification = await VetraAPI.request("/vendors/me/kyc/verify", {
          method: "POST",
          role: "vendor",
          body: {
            identityType: identityType.value,
            identityNumber: identityNumber.value.trim(),
            ...(identityType.value === "drivers_license" ? { dateOfBirth: dobInput.value } : {}),
            cacNumber,
          },
        });
      } catch (err) {
        verification = err.data || { verified: false };
        if (err.status !== 422) throw err;
      }
      // GET returns signed links to the documents; the stored URLs
      // themselves can't be opened directly.
      kyc = await VetraAPI.request("/vendors/me/kyc", { method: "GET", role: "vendor" });
      providerStatus.textContent = verification.verified
        ? "Identity and CAC checks passed."
        : "Your submission needs manual review.";
      applyKycStatus();
    } catch (err) {
      noteEl.style.color = "var(--c-red)";
      noteEl.textContent = err.message;
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
});
