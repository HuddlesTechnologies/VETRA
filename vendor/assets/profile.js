/* =========================================================
   VETRA — VENDOR PROFILE PAGE INTERACTIONS
   Page-specific script for vendor/profile.html only.

   The summary card, quick stats, and store-details form all ship
   as static markup in profile.html now. This file only wires up
   behavior: cover/avatar photo edit, the per-field store-details
   form, change password, danger zone, and sign out.
   ========================================================= */

/* ---------- COVER + AVATAR PHOTO STORAGE ----------
   There's no backend to upload to yet, so "saving" a photo here means
   converting it to a data URL and writing it to this browser's own
   localStorage (page-scoped to this vendor's profile only — separate
   from, and never written into, the admin console's own localStorage
   state). That's enough for the photo to actually survive a reload,
   which a bare object-URL preview cannot do (blob: URLs die with the
   page). Swap for a real upload endpoint once a backend exists. */
const AVATAR_PHOTO_KEY = "vetra_vendor_profile_avatar";
const COVER_PHOTO_KEY = "vetra_vendor_profile_cover";

function readSavedPhoto(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null; // localStorage unavailable (private mode, etc.)
  }
}

function writeSavedPhoto(key, dataUrl) {
  try {
    localStorage.setItem(key, dataUrl);
  } catch (e) {
    /* ignore write failures — the preview still worked for this page view */
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ---------- AVATAR EDIT ----------
   Opens the real device file picker (hidden <input type="file">), then
   opens the shared photo-preview popup (VendorUI.photoPreview(), see
   assets/ui.js) instead of applying the change silently or via tiny
   inline buttons — a large preview with full-size Save/Cancel buttons
   is much easier to hit and to actually judge the photo by than two
   icon-only buttons crowded onto the corner of a 76px circle. Saving
   also refreshes the header avatar (see VetraUI.applyCurrentVendorAvatar()
   in assets/interactions.js) so it doesn't keep showing the old photo
   on this page or any other. */
function wireAvatarEditButton() {
  const editBtn = document.getElementById("avatar-edit-btn");
  const input = document.getElementById("avatar-photo-input");
  const img = document.getElementById("profile-avatar-img");
  if (!editBtn || !input || !img) return;

  const saved = readSavedPhoto(AVATAR_PHOTO_KEY);
  if (saved) img.src = saved;

  editBtn.addEventListener("click", () => input.click());

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);

    VendorUI.photoPreview({
      title: "Update profile photo",
      imageUrl: objectUrl,
      shape: "avatar",
      onSave: async () => {
        const dataUrl = await fileToDataUrl(file);
        writeSavedPhoto(AVATAR_PHOTO_KEY, dataUrl);
        img.src = dataUrl;
        URL.revokeObjectURL(objectUrl);
        input.value = "";
        VetraUI.applyCurrentVendorAvatar();
      },
      onCancel: () => {
        URL.revokeObjectURL(objectUrl);
        input.value = "";
      },
    });
  });
}

/* ---------- STORE BACKGROUND / COVER PHOTO EDIT ----------
   Same picker + preview-popup pattern as the avatar above, applied to
   the cover banner behind it. */
function wireCoverEditButton() {
  const editBtn = document.getElementById("cover-edit-btn");
  const input = document.getElementById("cover-photo-input");
  const cover = document.getElementById("profile-cover");
  if (!editBtn || !input || !cover) return;

  const saved = readSavedPhoto(COVER_PHOTO_KEY);
  if (saved) cover.style.backgroundImage = `url('${saved}')`;

  editBtn.addEventListener("click", () => input.click());

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);

    VendorUI.photoPreview({
      title: "Update store background photo",
      imageUrl: objectUrl,
      shape: "cover",
      onSave: async () => {
        const dataUrl = await fileToDataUrl(file);
        writeSavedPhoto(COVER_PHOTO_KEY, dataUrl);
        cover.style.backgroundImage = `url('${dataUrl}')`;
        URL.revokeObjectURL(objectUrl);
        input.value = "";
      },
      onCancel: () => {
        URL.revokeObjectURL(objectUrl);
        input.value = "";
      },
    });
  });
}

/* ---------- STORE DETAILS — per-field inline edit ----------
   Each field in #profile-form ships as plain read-only text (the
   .field-view markup) with its own pencil button, plus a hidden
   .field-edit row holding the real input and a confirm/cancel pair.
   Clicking the pencil unlocks only that one field; every other field
   stays as read-only text. Confirm commits the value back to the
   display text (and mirrors store-name/owner-name onto the summary
   card above); cancel discards the edit. */
function wireStoreDetailsFields() {
  const form = document.getElementById("profile-form");
  if (!form) return;

  // Enter inside a text input would otherwise submit this form natively.
  form.addEventListener("submit", (e) => e.preventDefault());

  form.querySelectorAll(".form-group[data-field]").forEach((group) => {
    const fieldId = group.dataset.field;
    const input = document.getElementById(fieldId);
    const display = document.getElementById(`${fieldId}-display`);
    const viewRow = group.querySelector(".field-view");
    const editRow = group.querySelector(".field-edit");
    const editBtn = group.querySelector(".field-edit-btn");
    const confirmBtn = group.querySelector(".field-confirm-btn");
    const cancelBtn = group.querySelector(".field-cancel-btn");
    if (!input || !display || !viewRow || !editRow) return;

    display.textContent = input.value;

    function enterEdit() {
      input.value = display.textContent;
      viewRow.hidden = true;
      editRow.hidden = false;
      input.focus();
      input.select();
    }

    function exitEdit() {
      viewRow.hidden = false;
      editRow.hidden = true;
    }

    editBtn.addEventListener("click", enterEdit);

    cancelBtn.addEventListener("click", () => {
      input.value = display.textContent;
      exitEdit();
    });

    confirmBtn.addEventListener("click", () => {
      const value = input.value.trim();
      if (!value) return;
      display.textContent = value;
      exitEdit();
      // TODO: replace with a real per-field save API call.
      if (fieldId === "store-name") {
        document.getElementById("profile-store-name").textContent = value;
      }
      if (fieldId === "owner-name") {
        document.getElementById("profile-owner-name").textContent =
          `${value} · Vendor since Jan 2026`;
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.tagName !== "TEXTAREA") {
        e.preventDefault();
        confirmBtn.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelBtn.click();
      }
    });
  });
}

/* ---------- SECURITY ---------- */
function wireChangePasswordButton() {
  const btn = document.getElementById("change-password-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // TODO: replace with real navigation to a change-password flow.
    VendorUI.info({ title: "Not wired up yet", bodyHtml: "Hook this up to your change-password flow." });
  });
}

/* ---------- DANGER ZONE ---------- */
function wireDangerZoneButtons() {
  const deactivateBtn = document.getElementById("deactivate-store-btn");
  if (deactivateBtn) {
    deactivateBtn.addEventListener("click", () => {
      VendorUI.confirm({
        title: "Deactivate your store?",
        bodyHtml: "Buyers won't be able to see your listings until you reactivate.",
        confirmLabel: "Deactivate",
        danger: true,
        onConfirm: () => {
          // TODO: replace with a real deactivate API call.
          VendorUI.info({ title: "Store deactivated", bodyHtml: "Hook this up to your API." });
        },
      });
    });
  }

  const deleteBtn = document.getElementById("delete-account-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      VendorUI.confirm({
        title: "Delete your vendor account?",
        bodyHtml: "This cannot be undone.",
        confirmLabel: "Delete account",
        danger: true,
        onConfirm: () => {
          // TODO: replace with a real delete-account API call.
          VendorUI.info({ title: "Account deletion requested", bodyHtml: "Hook this up to your API." });
        },
      });
    });
  }
}

/* ---------- SIGN OUT ---------- */
function wireSignOutButton() {
  const btn = document.getElementById("sign-out-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    VendorUI.confirm({
      title: "Sign out",
      bodyHtml: "Sign out of your vendor account?",
      confirmLabel: "Sign out",
      onConfirm: () => {
        window.location.href = "../signin.html";
      },
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireAvatarEditButton();
  wireCoverEditButton();
  wireStoreDetailsFields();
  wireChangePasswordButton();
  wireDangerZoneButtons();
  wireSignOutButton();
});
