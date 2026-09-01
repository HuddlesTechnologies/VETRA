/* =========================================================
   VETRA — VENDOR PROFILE PAGE INTERACTIONS
   Page-specific script for vendor/profile.html only.

   The summary card, quick stats, and store-details form all ship
   as static markup in profile.html now. This file only wires up
   behavior: avatar edit, the locked/unlocked store-details form,
   change password, danger zone, and sign out.
   ========================================================= */

/* ---------- AVATAR EDIT ---------- */
function wireAvatarEditButton() {
  const btn = document.getElementById("avatar-edit-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // TODO: replace with a real file picker + upload call.
    alert("Hook this up to your avatar upload flow.");
  });
}

/* ---------- STORE DETAILS FORM — locked until "Edit Profile" ----------
   Every field in #profile-form ships with the `readonly` attribute in
   profile.html, so nothing is editable on page load. Clicking "Edit
   Profile" is the only thing that unlocks them; Save or Cancel both
   lock them again afterwards. */
function setProfileFormEditable(editable) {
  const form = document.getElementById("profile-form");
  if (!form) return;
  form.querySelectorAll(".form-input, .form-textarea").forEach((field) => {
    field.readOnly = !editable;
  });
  form.classList.toggle("is-editing", editable);
}

/* ---------- HEADER "EDIT PROFILE" SHORTCUT ---------- */
function wireProfileEditButton() {
  const btn = document.getElementById("profile-edit-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    setProfileFormEditable(true);
    document.getElementById("store-name")?.focus();
    document
      .getElementById("profile-form")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

/* ---------- STORE DETAILS FORM ---------- */
function wireProfileForm() {
  const form = document.getElementById("profile-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    // TODO: replace with a real save API call. For now, just reflect
    // the store name / owner name back onto the summary card so the
    // page feels responsive.
    const storeName = document.getElementById("store-name")?.value.trim();
    const ownerName = document.getElementById("owner-name")?.value.trim();
    if (storeName) document.getElementById("profile-store-name").textContent = storeName;
    if (ownerName) {
      document.getElementById("profile-owner-name").textContent =
        `${ownerName} · Vendor since Jan 2024`;
    }
    setProfileFormEditable(false);
    alert("Profile saved (hook this up to your save API).");
  });

  const cancelBtn = document.getElementById("profile-cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      form.reset();
      setProfileFormEditable(false);
    });
  }
}

/* ---------- SECURITY ---------- */
function wireChangePasswordButton() {
  const btn = document.getElementById("change-password-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // TODO: replace with real navigation to a change-password flow.
    alert("Hook this up to your change-password flow.");
  });
}

/* ---------- DANGER ZONE ---------- */
function wireDangerZoneButtons() {
  const deactivateBtn = document.getElementById("deactivate-store-btn");
  if (deactivateBtn) {
    deactivateBtn.addEventListener("click", () => {
      const confirmed = confirm(
        "Deactivate your store? Buyers won't be able to see your listings until you reactivate."
      );
      if (confirmed) {
        // TODO: replace with a real deactivate API call.
        alert("Store deactivated (hook this up to your API).");
      }
    });
  }

  const deleteBtn = document.getElementById("delete-account-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      const confirmed = confirm("Delete your vendor account? This cannot be undone.");
      if (confirmed) {
        // TODO: replace with a real delete-account API call.
        alert("Account deletion requested (hook this up to your API).");
      }
    });
  }
}

/* ---------- SIGN OUT ---------- */
function wireSignOutButton() {
  const btn = document.getElementById("sign-out-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const confirmed = confirm("Sign out of your vendor account?");
    if (confirmed) {
      window.location.href = "../signin.html";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireAvatarEditButton();
  wireProfileEditButton();
  wireProfileForm();
  wireChangePasswordButton();
  wireDangerZoneButtons();
  wireSignOutButton();
});
