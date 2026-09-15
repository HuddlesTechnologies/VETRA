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

/* ---------- STORE DETAILS — per-field inline edit, real backend ----------
   Each field in #profile-form ships as plain read-only text (the
   .field-view markup) with its own pencil button, plus a hidden
   .field-edit row holding the real input and a confirm/cancel pair.
   Clicking the pencil unlocks only that one field; every other field
   stays as read-only text.

   On load, fetches the real signed-in vendor's profile (GET
   /api/auth/me) and populates every field from it — the HTML's
   value="..." attributes are now just a same-shape placeholder for
   when the fetch hasn't resolved yet, not the source of truth.
   Confirming a field PATCHes just that one field (PATCH /api/auth/me,
   body { [key]: value }) and updates the display + summary card from
   the real response, rather than trusting the typed value blindly. */
const STORE_DETAILS_FIELD_MAP = {
  "store-name": "storeName",
  "owner-name": "name",
  "store-email": "email",
  "store-phone": "phone",
  "store-address": "address",
  "store-bio": "storeDescription",
};

async function wireStoreDetailsFields() {
  const form = document.getElementById("profile-form");
  if (!form) return;

  // Enter inside a text input would otherwise submit this form natively.
  form.addEventListener("submit", (e) => e.preventDefault());

  let memberSinceLabel = "—";
  const groups = {};
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
    groups[fieldId] = { input, display, viewRow, editRow };

    display.textContent = input.value;
    display.dataset.rawValue = input.value;

    // display.textContent shows "—" for a genuinely-empty field (see the
    // real-data population below), which must become an empty input, not
    // the literal text "—" — the real value lives on the input's own
    // dataset, not parsed back out of the display text.
    function enterEdit() {
      input.value = display.dataset.rawValue || "";
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
      input.value = display.dataset.rawValue || "";
      exitEdit();
    });

    confirmBtn.addEventListener("click", async () => {
      const value = input.value.trim();
      if (!value) return;
      const bodyKey = STORE_DETAILS_FIELD_MAP[fieldId];
      confirmBtn.disabled = true;
      try {
        const updated = await VetraAPI.request("/auth/me", {
          method: "PATCH",
          role: "vendor",
          body: { [bodyKey]: value },
        });
        display.textContent = value;
        display.dataset.rawValue = value;
        exitEdit();
        if (fieldId === "store-name") {
          document.getElementById("profile-store-name").textContent = updated.store_name;
        }
        if (fieldId === "owner-name") {
          document.getElementById("profile-owner-name").textContent =
            `${updated.name} · Vendor since ${memberSinceLabel}`;
        }
        // Keep the cached signin-time user object in sync too, so a page
        // that only reads localStorage (not a fresh fetch) still sees it.
        VetraAPI.setSession("vendor", VetraAPI.getToken("vendor"), {
          ...VetraAPI.getUser("vendor"),
          name: updated.name,
        });
      } catch (err) {
        VendorUI.info({ title: "Couldn't save", bodyHtml: err.message });
      } finally {
        confirmBtn.disabled = false;
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

  // Populate every field from the real account once it's fetched —
  // the static HTML value="..." attributes above are just a same-shape
  // placeholder shown until this resolves.
  try {
    const me = await VetraAPI.request("/auth/me", { method: "GET", role: "vendor" });
    const values = {
      "store-name": me.store_name,
      "owner-name": me.name,
      "store-email": me.email,
      "store-phone": me.phone,
      "store-address": me.address,
      "store-bio": me.store_description,
    };
    Object.entries(values).forEach(([fieldId, value]) => {
      const g = groups[fieldId];
      if (!g) return;
      // A real, genuinely-empty value must overwrite the static HTML's
      // placeholder text — leaving it in place would show old sample
      // data (e.g. "Asokoro, Abuja, Nigeria") as if it were this
      // account's real address, which it isn't.
      const text = value === null || value === undefined ? "" : value;
      g.input.value = text;
      g.display.textContent = text || "—";
      g.display.dataset.rawValue = text;
    });

    memberSinceLabel = me.created_at
      ? new Date(me.created_at).toLocaleDateString("en-NG", { month: "short", year: "numeric" })
      : "—";
    document.getElementById("profile-store-name").textContent = me.store_name || "—";
    document.getElementById("profile-owner-name").textContent = `${me.name} · Vendor since ${memberSinceLabel}`;
    const memberSinceStat = document.getElementById("profile-member-since");
    if (memberSinceStat) memberSinceStat.textContent = memberSinceLabel;
  } catch (err) {
    // Session guard in interactions.js already ensures a token exists;
    // a fetch failure here is a network/server issue, not "not signed
    // in" — leave the placeholder values in place rather than blocking
    // the page on it.
    console.error("Failed to load vendor profile:", err);
  }
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
