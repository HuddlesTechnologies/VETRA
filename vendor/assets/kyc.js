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
  const cacTypeSelect = document.getElementById("kyc-cac-type");
  const voterStateGroup = document.getElementById("kyc-voter-state-group");
  const voterStateSelect = document.getElementById("kyc-voter-state");
  const voterLgaGroup = document.getElementById("kyc-voter-lga-group");
  const voterLgaInput = document.getElementById("kyc-voter-lga");
  const payoutNote = document.getElementById("kyc-payout-note");
  const legalGroups = ["first", "middle", "last"].map((part) => document.getElementById(`kyc-legal-${part}-group`));
  const legalFirst = document.getElementById("kyc-legal-first");
  const legalMiddle = document.getElementById("kyc-legal-middle");
  const legalLast = document.getElementById("kyc-legal-last");
  // True for Google sign-ups and older accounts with no legal name stored;
  // the verify route then takes the name from these fields.
  let legalNameMissing = false;
  function showLegalNameFields(show) {
    legalNameMissing = show;
    legalGroups.forEach((group) => { if (group) group.hidden = !show; });
    legalFirst.required = show;
    legalLast.required = show;
  }

  voterStateSelect.innerHTML = `<option value="">Choose a state</option>${stateOptionsMarkup("")}`;

  const NUMBER_HINT = {
    nin: "11-digit NIN",
    bvn: "11-digit BVN",
    drivers_license: "e.g. ABC12345AA01",
    voters_card: "VIN printed on your card",
  };
  identityType.addEventListener("change", () => {
    const isLicence = identityType.value === "drivers_license";
    const isVoter = identityType.value === "voters_card";
    dobGroup.hidden = !isLicence;
    dobInput.required = isLicence;
    voterStateGroup.hidden = !isVoter;
    voterLgaGroup.hidden = !isVoter;
    identityNumber.placeholder = NUMBER_HINT[identityType.value] || "";
    identityNumber.inputMode = isLicence || isVoter ? "text" : "numeric";
  });

  // Same rules as POST /api/vendors/me/kyc/verify, checked before the
  // documents upload so a typo doesn't leave a half-finished submission.
  // "RC 123-4567", "rc1234567" and "1234567" are all fine.
  function parseCac(value) {
    const compact = String(value || "").toUpperCase().replace(/[\s\-./]/g, "");
    const match = /^(LLP|RC|BN|IT|LP)?(\d{4,15})$/.exec(compact);
    if (!match) return null;
    return { type: match[1] || cacTypeSelect.value || "RC", digits: match[2] };
  }
  function identityProblem() {
    if (legalNameMissing && (!legalFirst.value.trim() || !legalLast.value.trim())) {
      return "Enter your legal first and last name exactly as they appear on your ID.";
    }
    const type = identityType.value;
    const number = identityNumber.value.trim().toUpperCase().replace(/\s/g, "");
    if (!type) return "Choose the type of ID you're using.";
    if ((type === "nin" || type === "bvn") && !/^\d{11}$/.test(number)) return `Your ${type.toUpperCase()} is 11 digits.`;
    if (type === "drivers_license" && !/^[A-Z0-9-]{6,20}$/.test(number)) return "Enter your licence number as printed, letters and digits only.";
    if (type === "drivers_license" && !dobInput.value) return "Enter the date of birth on your licence.";
    if (type === "voters_card" && !/^[A-Z0-9]{9,23}$/.test(number)) return "Enter the VIN on your voter's card, letters and digits only.";
    if (type === "voters_card" && (!voterStateSelect.value || !voterLgaInput.value.trim())) return "Choose the state and enter the LGA printed on your voter's card.";
    return null;
  }

  // The business check compares this bank-resolved name with the CAC
  // record, so there's no point submitting without one.
  let payoutAccount = null;
  async function loadPayoutAccount() {
    try {
      payoutAccount = await VetraAPI.request("/vendors/me/payout-account", { method: "GET", role: "vendor" });
    } catch {
      payoutAccount = null;
    }
    payoutNote.textContent = "";
    if (payoutAccount?.isSet) {
      payoutNote.style.color = "";
      payoutNote.append("Your payout account is in the name ");
      const strong = document.createElement("strong");
      strong.textContent = payoutAccount.accountName;
      payoutNote.append(strong, ". This must match the business name on your CAC registration.");
    } else if (payoutAccount) {
      payoutNote.style.color = "var(--c-orange)";
      payoutNote.innerHTML = 'You haven\'t added a payout bank account yet. <a href="earnings.html">Add it on the Earnings page</a> before verifying.';
    }
  }

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
  // photo, never a video; documents up to 50MB, photos up to 10MB.
  const MAX_KYC_BYTES = 50 * 1024 * 1024;
  function kycFileProblem(file) {
    if (/^video\//i.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp|wmv|flv|mpe?g)$/i.test(file.name)) {
      return "Videos can't be used for verification. Upload a photo, scan or document instead.";
    }
    const isPhoto = /^image\//i.test(file.type) || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name);
    if (isPhoto && file.size > 10 * 1024 * 1024) return "That photo is over 10MB. Choose a smaller photo.";
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

  // One line per check, with the reason in plain English when it failed.
  // Built with textContent: the messages carry names from CAC and the bank.
  function checkLine(title, status, message) {
    const line = document.createElement("p");
    line.style.margin = "4px 0";
    const passed = status === "verified";
    line.style.color = passed ? "var(--c-green)" : status === "failed" ? "var(--c-red)" : "";
    const head = document.createElement("strong");
    head.textContent = `${passed ? "✓" : status === "failed" ? "✗" : "•"} ${title}: ${passed ? "passed" : status === "failed" ? "failed" : "not checked yet"}`;
    line.appendChild(head);
    if (message && status) line.append(` ${message}`);
    return line;
  }
  function renderProviderStatus(result) {
    const identity = result ? result.identity?.status : kyc.identityProviderStatus;
    const cac = result ? result.cac?.status : kyc.cacProviderStatus;
    const identityMessage = result ? result.identity?.message : kyc.identityProviderMessage;
    const cacMessage = result ? result.cac?.message : kyc.cacProviderMessage;
    providerStatus.replaceChildren();
    if (!identity && !cac) {
      providerStatus.textContent = "No automatic verification has been completed yet. Both checks below must pass for your store to be verified.";
      return;
    }
    const both = identity === "verified" && cac === "verified";
    const intro = document.createElement("p");
    intro.style.margin = "0 0 4px";
    intro.style.fontWeight = "700";
    intro.textContent = both
      ? "Both checks passed. Your business is verified."
      : "Verification didn't pass. Both checks must pass, fix what's marked ✗ below and submit again.";
    providerStatus.append(
      intro,
      checkLine("ID check (your name on VETRA vs your ID)", identity, identityMessage),
      checkLine("Business check (CAC registration vs your bank account name)", cac, cacMessage)
    );
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
      const autoCheckFailed = kyc.identityProviderStatus === "failed" || kyc.cacProviderStatus === "failed";
      summaryNote.textContent = autoCheckFailed
        ? "Your verification didn't pass. See what went wrong below, fix it, then upload your documents and submit again."
        : kyc.rejectionReason
          ? `Rejected: ${kyc.rejectionReason}. Update your documents below and resubmit.`
          : "Your documents were rejected, update them below and resubmit.";
    }

    submitBtn.textContent = needsResubmit ? "Resubmit for verification" : "Submit for verification";
    if (needsResubmit && kyc.cacNumber) {
      const previous = /^(LLP|RC|BN|IT|LP)?(\d+)$/.exec(String(kyc.cacNumber).toUpperCase().replace(/[\s\-]/g, ""));
      if (previous) {
        if (previous[1]) cacTypeSelect.value = previous[1];
        cacNumberInput.value = previous[2];
      } else {
        cacNumberInput.value = kyc.cacNumber;
      }
    }
    renderProviderStatus();
  }

  try {
    kyc = await VetraAPI.request("/vendors/me/kyc", { method: "GET", role: "vendor" });
  } catch (err) {
    console.error("Failed to load KYC status:", err);
  }
  showLegalNameFields(!!kyc?.legalNameMissing);
  applyKycStatus();
  await loadPayoutAccount();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const cac = parseCac(cacNumberInput.value);
    const problem = identityProblem()
      || (!cac ? "Enter your CAC registration number, for example 1234567. You don't need to type RC or BN in front." : null)
      || (!slots.id.file || !slots.cac.file ? "Upload both your ID and your CAC certificate before submitting." : null)
      || (payoutAccount && !payoutAccount.isSet ? "Add your payout bank account on the Earnings page first. We check that it's in the same name as your CAC registration." : null);
    if (problem) {
      noteEl.textContent = problem;
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
      const cacNumber = `${cac.type}${cac.digits}`;
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
            ...(legalNameMissing ? {
              legalFirstName: legalFirst.value.trim(),
              legalMiddleName: legalMiddle.value.trim(),
              legalLastName: legalLast.value.trim(),
            } : {}),
            ...(identityType.value === "drivers_license" ? { dateOfBirth: dobInput.value } : {}),
            ...(identityType.value === "voters_card" ? { voterState: voterStateSelect.value, voterLga: voterLgaInput.value.trim() } : {}),
            cacNumber,
            cacType: cac.type,
          },
        });
      } catch (err) {
        verification = err.data || { verified: false };
        if (err.status !== 422) throw err;
      }
      // GET returns signed links to the documents; the stored URLs
      // themselves can't be opened directly.
      kyc = await VetraAPI.request("/vendors/me/kyc", { method: "GET", role: "vendor" });
      showLegalNameFields(!!kyc?.legalNameMissing);
      applyKycStatus();
      if (verification.identity && verification.cac) renderProviderStatus(verification);
      submitBtn.disabled = false;
      if (!verification.verified) {
        noteEl.style.color = "var(--c-red)";
        noteEl.textContent = "Verification didn't pass. Both checks must pass, see the reasons below.";
        providerStatus.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (err) {
      noteEl.style.color = "var(--c-red)";
      noteEl.textContent = err.message;
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
});
