/* =========================================================
   VETRA — ADMIN SETTINGS (admin/settings.html, real backend)

   1. "My Profile" — real GET/PATCH /api/auth/me, same per-field
      inline-edit pattern as vendor/assets/profile.js. Avatar upload
      goes through POST /api/uploads — this will error until
      Cloudinary's env vars are configured on Render (see
      backend/README.md's "What's deliberately stubbed"); the code
      itself is correct and will start working the moment that is.

   2. Site banners — real GET/POST/PATCH(order)/DELETE
      /api/site-banners (Super Admin only for writes). Same
      Cloudinary caveat as the avatar upload above.

   3. Admin Team — real GET/DELETE /api/admin/team (removing the
      last Super Admin is blocked server-side, not just here).

   4. Pending Invitations — real GET/DELETE /api/admin/invites plus
      POST /invites + POST /invites/:id/verify for the two-step
      add-admin flow. The verification code isn't emailed yet (no
      provider configured) — it's logged on the Render server, so
      the UI says exactly that instead of pretending it was sent.

   5. "Reset Demo Data" has no real-backend equivalent — this is a
      live production database now, not swappable demo state — so
      it's disabled with an explanation instead of wired to anything
      destructive. "Sign Out" clears the real admin session.
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;

  // Every listener attaches synchronously, before any network call — a
  // click during a slow (e.g. Render cold-start) initial load must still
  // work immediately, not silently do nothing until a chain of awaited
  // fetches finishes. Only the render*() calls below actually need data,
  // and they run in parallel rather than one-after-another.
  wireMyProfileFields();
  wireAvatarUpload();
  wireAddAdminModal();
  wireVerifyInviteModal();
  wireSiteBanners();

  const resetBtn = document.getElementById("reset-demo-data-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      AdminUI.info({
        title: "Not available on a live database",
        bodyHtml: "This button reset the old demo's mock data. There's no equivalent now that this is a real, shared production database — resetting it would delete real customers, vendors, and orders.",
      });
    });
  }

  document.getElementById("admin-sign-out-btn").addEventListener("click", () => {
    AdminUI.confirm({
      title: "Sign out",
      bodyHtml: "Sign out of the admin console on this device?",
      confirmLabel: "Sign out",
      onConfirm: () => {
        VetraAPI.clearSession("admin");
        window.location.href = "login.html";
      },
    });
  });

  await Promise.all([renderMyProfile(), renderTeam(), renderPendingInvites(), renderSiteBanners()]);
});

let currentMe = null;

/* ---------------- My Profile ---------------- */
async function renderMyProfile() {
  try {
    currentMe = await VetraAPI.request("/auth/me", { method: "GET", role: "admin" });
  } catch (err) {
    console.error("Failed to load admin profile:", err);
    return;
  }
  document.getElementById("my-profile-name").textContent = currentMe.name;
  document.getElementById("my-profile-email").textContent = `${currentMe.email} · Admin`;
  document.getElementById("my-profile-role-label").textContent = currentMe.admin_role;
  document.getElementById("my-profile-avatar").src = currentMe.avatar_url || "imgs/avatar-dummy.png";

  const nameDisplay = document.getElementById("my-name-display");
  const emailDisplay = document.getElementById("my-email-display");
  if (nameDisplay) {
    nameDisplay.textContent = currentMe.name;
    nameDisplay.dataset.rawValue = currentMe.name;
  }
  if (emailDisplay) {
    emailDisplay.textContent = currentMe.email;
    emailDisplay.dataset.rawValue = currentMe.email;
  }
}

/* ---------------- Account Details — per-field inline edit ---------------- */
function wireMyProfileFields() {
  const form = document.getElementById("my-profile-form");
  if (!form) return;

  form.addEventListener("submit", (e) => e.preventDefault());

  const fieldToProp = { "my-name": "name", "my-email": "email" };

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
      confirmBtn.disabled = true;
      try {
        const updated = await VetraAPI.request("/auth/me", {
          method: "PATCH", role: "admin", body: { [fieldToProp[fieldId]]: value },
        });
        display.textContent = value;
        display.dataset.rawValue = value;
        exitEdit();
        currentMe = updated;
        VetraAPI.setSession("admin", VetraAPI.getToken("admin"), {
          ...VetraAPI.getUser("admin"), name: updated.name, email: updated.email,
        });
        document.getElementById("my-profile-name").textContent = updated.name;
        document.getElementById("my-profile-email").textContent = `${updated.email} · Admin`;
        await renderTeam();
      } catch (err) {
        AdminUI.info({ title: "Couldn't save", bodyHtml: err.message });
      } finally {
        confirmBtn.disabled = false;
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmBtn.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelBtn.click();
      }
    });
  });
}

function wireAvatarUpload() {
  const btn = document.getElementById("change-avatar-btn");
  const input = document.getElementById("avatar-file-input");
  if (!btn || !input) return;

  btn.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const url = await VetraAPI.uploadFile(file, { role: "admin", folder: "avatars" });
      const updated = await VetraAPI.request("/auth/me", { method: "PATCH", role: "admin", body: { avatarUrl: url } });
      document.getElementById("my-profile-avatar").src = updated.avatar_url;
      await renderTeam();
    } catch (err) {
      AdminUI.info({ title: "Couldn't upload photo", bodyHtml: err.message });
    } finally {
      input.value = "";
    }
  });
}

/* ---------------- Site banners ---------------- */
async function renderSiteBanners() {
  const list = document.getElementById("site-banner-list");
  if (!list) return;

  let banners = [];
  try {
    banners = await VetraAPI.request("/site-banners", { method: "GET" });
  } catch (err) {
    list.innerHTML = `<p class="table-empty">Couldn't load banners: ${err.message}</p>`;
    return;
  }

  if (!banners.length) {
    list.innerHTML = `<p class="table-empty">No banner images set — the dashboard carousel will show nothing until you add one.</p>`;
    return;
  }

  list.innerHTML = banners
    .map(
      (b, i) => `
        <div class="site-banner-item" data-banner-id="${b.id}">
          <div class="site-banner-thumb"><img src="${b.imageUrl}" alt="${b.alt || ""}"></div>
          <div class="site-banner-item-actions">
            <button type="button" class="site-banner-move-btn" data-action="move-up" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button type="button" class="site-banner-move-btn" data-action="move-down" ${i === banners.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
            <button type="button" class="danger-btn" data-action="remove">Remove</button>
          </div>
        </div>
      `
    )
    .join("");
}

function wireSiteBanners() {
  const addBtn = document.getElementById("add-banner-btn");
  const fileInput = document.getElementById("banner-file-input");
  const list = document.getElementById("site-banner-list");
  if (!addBtn || !fileInput || !list) return;

  addBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const url = await VetraAPI.uploadFile(file, { role: "admin", folder: "banners" });
      await VetraAPI.request("/site-banners", {
        method: "POST", role: "admin",
        body: { imageUrl: url, alt: file.name.replace(/\.[^.]+$/, "") },
      });
      await renderSiteBanners();
    } catch (err) {
      AdminUI.info({ title: "Couldn't add banner", bodyHtml: err.message });
    } finally {
      fileInput.value = "";
    }
  });

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const item = btn.closest("[data-banner-id]");
    const bannerId = item.dataset.bannerId;

    if (btn.dataset.action === "move-up" || btn.dataset.action === "move-down") {
      try {
        await VetraAPI.request(`/site-banners/${bannerId}/order`, {
          method: "PATCH", role: "admin",
          body: { direction: btn.dataset.action === "move-up" ? "up" : "down" },
        });
        await renderSiteBanners();
      } catch (err) {
        AdminUI.info({ title: "Couldn't reorder banner", bodyHtml: err.message });
      }
    } else if (btn.dataset.action === "remove") {
      AdminUI.confirm({
        title: "Remove banner image",
        bodyHtml: "Remove this image from the dashboard carousel? Buyers will stop seeing it immediately.",
        confirmLabel: "Remove",
        danger: true,
        onConfirm: async () => {
          try {
            await VetraAPI.request(`/site-banners/${bannerId}`, { method: "DELETE", role: "admin" });
            await renderSiteBanners();
          } catch (err) {
            AdminUI.info({ title: "Couldn't remove banner", bodyHtml: err.message });
          }
        },
      });
    }
  });
}

/* ---------------- Team list ---------------- */
let currentTeam = [];

async function renderTeam() {
  const container = document.getElementById("admin-team-list");
  if (!container) return;

  try {
    currentTeam = await VetraAPI.request("/admin/team", { method: "GET", role: "admin" });
  } catch (err) {
    container.innerHTML = `<p class="table-empty">Couldn't load team: ${err.message}</p>`;
    return;
  }

  container.innerHTML = currentTeam
    .map((m) => {
      const avatar = m.avatar_url
        ? `<img class="team-row-avatar" src="${m.avatar_url}" alt="" />`
        : `<span class="cell-avatar">${VetraAdmin.initials(m.name)}</span>`;
      return `
    <div class="team-row" data-member-id="${m.id}">
      <div class="team-row-main">
        ${avatar}
        <div>
          <p class="cell-title">${m.name}${m.id === currentMe?.id ? " (you)" : ""}</p>
          <p class="cell-sub">${m.email}</p>
        </div>
      </div>
      <div class="table-actions" style="align-items: center;">
        <span class="badge ${m.admin_role === "Super Admin" ? "active" : "customer"}">${m.admin_role}</span>
        <button class="btn-suspend" data-action="remove-admin" data-id="${m.id}">Remove</button>
      </div>
    </div>
  `;
    })
    .join("");

  container.querySelectorAll('button[data-action="remove-admin"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const member = currentTeam.find((m) => m.id === btn.dataset.id);
      if (!member) return;
      AdminUI.confirm({
        title: "Remove admin",
        bodyHtml: `Remove <span class="confirm-modal-target">${member.name}</span> from the admin team? They will immediately lose access to this console.`,
        confirmLabel: "Remove",
        danger: true,
        onConfirm: async () => {
          try {
            await VetraAPI.request(`/admin/team/${member.id}`, { method: "DELETE", role: "admin" });
            await renderTeam();
          } catch (err) {
            AdminUI.info({ title: "Can't remove this admin", bodyHtml: err.message });
          }
        },
      });
    });
  });
}

/* ---------------- Pending invitations ---------------- */
async function renderPendingInvites() {
  const wrap = document.getElementById("pending-invites-wrap");
  const list = document.getElementById("pending-invites-list");
  if (!wrap || !list) return;

  let invites = [];
  try {
    invites = await VetraAPI.request("/admin/invites", { method: "GET", role: "admin" });
  } catch (err) {
    // Not a Super Admin, or the request failed — either way, no invites to manage here.
    wrap.hidden = true;
    return;
  }

  if (!invites.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  list.innerHTML = invites
    .map(
      (inv) => `
    <div class="invite-row" data-invite-id="${inv.id}">
      <div class="team-row-main">
        <span class="cell-avatar">${VetraAdmin.initials(inv.name)}</span>
        <div>
          <p class="cell-title">${inv.name}</p>
          <p class="cell-sub">${inv.email}</p>
        </div>
      </div>
      <div class="table-actions" style="align-items: center;">
        <span class="badge pending">awaiting verification</span>
        <button class="btn-view" data-action="verify-invite" data-id="${inv.id}">Verify</button>
        <button class="btn-suspend" data-action="cancel-invite" data-id="${inv.id}">Cancel</button>
      </div>
    </div>
  `
    )
    .join("");

  list.querySelectorAll('button[data-action="verify-invite"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const invite = invites.find((i) => i.id === btn.dataset.id);
      if (invite) openVerifyModal(invite);
    });
  });
  list.querySelectorAll('button[data-action="cancel-invite"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const invite = invites.find((i) => i.id === btn.dataset.id);
      if (!invite) return;
      AdminUI.confirm({
        title: "Cancel invitation",
        bodyHtml: `Cancel the pending invitation for <span class="confirm-modal-target">${invite.email}</span>? They won't be added to the admin team.`,
        confirmLabel: "Cancel invitation",
        danger: true,
        onConfirm: async () => {
          try {
            await VetraAPI.request(`/admin/invites/${invite.id}`, { method: "DELETE", role: "admin" });
            await renderPendingInvites();
          } catch (err) {
            AdminUI.info({ title: "Couldn't cancel invitation", bodyHtml: err.message });
          }
        },
      });
    });
  });
}

/* ---------------- Add Admin (step 1: invite) ---------------- */
function wireAddAdminModal() {
  const modal = document.getElementById("add-admin-modal");
  const openBtn = document.getElementById("add-admin-btn");
  const closeBtn = document.getElementById("add-admin-close");
  const cancelBtn = document.getElementById("add-admin-cancel");
  const form = document.getElementById("add-admin-form");
  if (!modal || !openBtn || !form) return;

  function open() {
    modal.hidden = false;
    document.getElementById("aa-name").focus();
  }
  function close() {
    modal.hidden = true;
    form.reset();
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("aa-name").value.trim();
    const email = document.getElementById("aa-email").value.trim();
    const role = document.getElementById("aa-role").value;
    if (!name || !email) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const invite = await VetraAPI.request("/admin/invites", {
        method: "POST", role: "admin", body: { name, email, adminRole: role },
      });
      close();
      await renderPendingInvites();
      openVerifyModal({ id: invite.id, name, email, admin_role: role });
    } catch (err) {
      AdminUI.info({ title: "Couldn't send invite", bodyHtml: err.message });
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------------- Verify Email (step 2) ---------------- */
function openVerifyModal(invite) {
  const modal = document.getElementById("verify-invite-modal");
  document.getElementById("verify-invite-desc").innerHTML =
    `${invite.name} (${invite.email}) will join as ${invite.admin_role} once verified.` +
    `<br><br><strong>Email delivery isn't configured on this deployment yet</strong> — the 6-digit code was ` +
    `printed to Render's server logs (Dashboard → your service → Logs) instead of emailed. Look for a line ` +
    `starting <code>[admin-invite]</code>.`;
  const codeInput = document.getElementById("vi-code");
  codeInput.value = "";
  codeInput.style.borderColor = "";
  modal.dataset.inviteId = invite.id;
  modal.hidden = false;
  codeInput.focus();
}

function wireVerifyInviteModal() {
  const modal = document.getElementById("verify-invite-modal");
  const closeBtn = document.getElementById("verify-invite-close");
  const form = document.getElementById("verify-invite-form");
  if (!modal || !form) return;

  function close() {
    modal.hidden = true;
    delete modal.dataset.inviteId;
  }

  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inviteId = modal.dataset.inviteId;
    const codeEntered = document.getElementById("vi-code").value.trim();

    try {
      const result = await VetraAPI.request(`/admin/invites/${inviteId}/verify`, {
        method: "POST", role: "admin", body: { code: codeEntered },
      });
      close();
      await renderTeam();
      await renderPendingInvites();
      AdminUI.info({
        title: "Admin added",
        bodyHtml: `
          <p style="margin:0 0 10px; font-size:13px; color:var(--muted);">
            Share this temporary password with them securely — they'll be required to set a new one at next sign-in.
            (This is only shown here because there's no email step yet.)
          </p>
          <div class="reveal-panel">
            <p>Temporary password</p>
            <div class="reveal-value">${result.tempPassword}</div>
          </div>
        `,
      });
    } catch (err) {
      const input = document.getElementById("vi-code");
      input.style.borderColor = "#e0475c";
      input.focus();
      AdminUI.info({ title: "Couldn't verify code", bodyHtml: err.message });
    }
  });
}
