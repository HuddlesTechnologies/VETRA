/* =========================================================
   VETRA — ADMIN SETTINGS (admin/settings.html)

   Three real, working things live on this page:

   1. "My Profile" reflects whoever is actually the current
      (simulated) admin session — see VetraAdmin.getCurrentAdmin()
      — including a working photo upload (FileReader -> base64,
      stored on that admin's team record) instead of a "hook this
      up" placeholder, since the console already has real
      localStorage persistence to write it to.

   2. Admin Team management: Add Admin is a two-step invite +
      email-verification flow (no real mail server, so the
      "email" is a verification code shown right in the UI —
      see the Verify Email modal), and each row has a Remove
      action through the shared confirm modal. Removing the
      platform's last Super Admin is blocked.

   3. "Reset Demo Data" / "Sign Out", same as before.

   The platform-control switches are cosmetic, matching the same
   pattern used on vendor/profile.html.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  renderMyProfile();
  renderTeam();
  renderPendingInvites();
  wireAvatarUpload();
  wireMyProfileFields();
  wireAddAdminModal();
  wireVerifyInviteModal();
  renderSiteBanners();
  wireSiteBanners();

  document.getElementById("reset-demo-data-btn").addEventListener("click", () => {
    AdminUI.confirm({
      title: "Reset demo data",
      bodyHtml:
        "This restores every customer, vendor, report, activity log entry, and the admin team roster to its original demo state. Any changes you've made in this browser will be lost.",
      confirmLabel: "Reset data",
      danger: true,
      onConfirm: () => {
        VetraAdmin.resetDemoData();
        window.location.href = "dashboard.html";
      },
    });
  });

  document.getElementById("admin-sign-out-btn").addEventListener("click", () => {
    AdminUI.confirm({
      title: "Sign out",
      bodyHtml: "Sign out of the admin console on this device?",
      confirmLabel: "Sign out",
      onConfirm: () => {
        window.location.href = "../signin.html";
      },
    });
  });
});

/* ---------------- My Profile ---------------- */
function renderMyProfile() {
  const me = VetraAdmin.getCurrentAdmin();
  if (!me) return;
  document.getElementById("my-profile-name").textContent = me.name;
  document.getElementById("my-profile-email").textContent = `${me.email} · Admin`;
  document.getElementById("my-profile-role-label").textContent = me.role;
  document.getElementById("my-profile-avatar").src = me.avatarDataUrl || "imgs/avatar-dummy.png";

  const nameDisplay = document.getElementById("my-name-display");
  const emailDisplay = document.getElementById("my-email-display");
  if (nameDisplay) nameDisplay.textContent = me.name;
  if (emailDisplay) emailDisplay.textContent = me.email;
}

/* ---------------- Account Details — per-field inline edit ----------------
   Same pattern as vendor/assets/profile.js's Store Details card: each
   field starts as plain read-only text with its own pencil button;
   clicking it unlocks only that one field. Confirm writes through
   VetraAdmin.updateTeamMemberProfile() (shared console state, so it
   also shows up correctly in the Admin Team list below) instead of
   this page's own localStorage. */
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
      const me = VetraAdmin.getCurrentAdmin();
      if (!me) return;
      VetraAdmin.updateTeamMemberProfile(me.id, { [fieldToProp[fieldId]]: value });
      renderMyProfile();
      renderTeam();
      exitEdit();
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

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const me = VetraAdmin.getCurrentAdmin();
      if (!me) return;
      VetraAdmin.setTeamMemberAvatar(me.id, reader.result);
      renderMyProfile();
      renderTeam();
      AdminUI.applyCurrentAdminAvatar();
    };
    reader.readAsDataURL(file);
    input.value = "";
  });
}

/* ---------------- Site banners (customer/dashboard.html carousel) ----------------
   Same FileReader -> base64 -> localStorage pattern as the avatar upload
   above (there's no real file storage yet, so this is as close to a real
   upload as the prototype can get). Each row's Up/Down buttons reorder in
   place; carousel order on the dashboard matches this list's order. */
function renderSiteBanners() {
  const list = document.getElementById("site-banner-list");
  if (!list) return;
  const banners = VetraAdmin.getSiteBanners();

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

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      VetraAdmin.addSiteBanner(reader.result, file.name.replace(/\.[^.]+$/, ""));
      renderSiteBanners();
    };
    reader.readAsDataURL(file);
    fileInput.value = "";
  });

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const item = btn.closest("[data-banner-id]");
    const bannerId = item.dataset.bannerId;

    if (btn.dataset.action === "move-up") {
      VetraAdmin.moveSiteBanner(bannerId, "up");
      renderSiteBanners();
    } else if (btn.dataset.action === "move-down") {
      VetraAdmin.moveSiteBanner(bannerId, "down");
      renderSiteBanners();
    } else if (btn.dataset.action === "remove") {
      AdminUI.confirm({
        title: "Remove banner image",
        bodyHtml: "Remove this image from the dashboard carousel? Buyers will stop seeing it immediately.",
        confirmLabel: "Remove",
        danger: true,
        onConfirm: () => {
          VetraAdmin.removeSiteBanner(bannerId);
          renderSiteBanners();
        },
      });
    }
  });
}

/* ---------------- Team list ---------------- */
function renderTeam() {
  const container = document.getElementById("admin-team-list");
  if (!container) return;
  const team = VetraAdmin.getTeam();
  const me = VetraAdmin.getCurrentAdmin();

  container.innerHTML = team
    .map((m) => {
      const avatar = m.avatarDataUrl
        ? `<img class="team-row-avatar" src="${m.avatarDataUrl}" alt="" />`
        : `<span class="cell-avatar">${VetraAdmin.initials(m.name)}</span>`;
      return `
    <div class="team-row" data-member-id="${m.id}">
      <div class="team-row-main">
        ${avatar}
        <div>
          <p class="cell-title">${m.name}${m.id === me?.id ? " (you)" : ""}</p>
          <p class="cell-sub">${m.email}</p>
        </div>
      </div>
      <div class="table-actions" style="align-items: center;">
        <span class="badge ${m.role === "Super Admin" ? "active" : "customer"}">${m.role}</span>
        <button class="btn-suspend" data-action="remove-admin" data-id="${m.id}">Remove</button>
      </div>
    </div>
  `;
    })
    .join("");

  container.querySelectorAll('button[data-action="remove-admin"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const member = VetraAdmin.getTeamMember(btn.dataset.id);
      if (!member) return;
      AdminUI.confirm({
        title: "Remove admin",
        bodyHtml: `Remove <span class="confirm-modal-target">${member.name}</span> from the admin team? They will immediately lose access to this console.`,
        confirmLabel: "Remove",
        danger: true,
        onConfirm: () => {
          const result = VetraAdmin.removeTeamMember(member.id);
          if (!result.ok && result.error === "last-super-admin") {
            AdminUI.info({
              title: "Can't remove this admin",
              bodyHtml: "You can't remove the last Super Admin. Promote another admin to Super Admin first.",
            });
            return;
          }
          renderTeam();
        },
      });
    });
  });
}

/* ---------------- Pending invitations ---------------- */
function renderPendingInvites() {
  const wrap = document.getElementById("pending-invites-wrap");
  const list = document.getElementById("pending-invites-list");
  const invites = VetraAdmin.getPendingInvites();

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
    btn.addEventListener("click", () => openVerifyModal(btn.dataset.id));
  });
  list.querySelectorAll('button[data-action="cancel-invite"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const invite = VetraAdmin.getPendingInvite(btn.dataset.id);
      if (!invite) return;
      AdminUI.confirm({
        title: "Cancel invitation",
        bodyHtml: `Cancel the pending invitation for <span class="confirm-modal-target">${invite.email}</span>? They won't be added to the admin team.`,
        confirmLabel: "Cancel invitation",
        danger: true,
        onConfirm: () => {
          VetraAdmin.cancelInvite(invite.id);
          renderPendingInvites();
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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("aa-name").value.trim();
    const email = document.getElementById("aa-email").value.trim();
    const role = document.getElementById("aa-role").value;
    if (!name || !email) return;

    const invite = VetraAdmin.inviteTeamMember({ name, email, role });
    close();
    renderPendingInvites();
    openVerifyModal(invite.id);
  });
}

/* ---------------- Verify Email (step 2) ---------------- */
function openVerifyModal(inviteId) {
  const invite = VetraAdmin.getPendingInvite(inviteId);
  if (!invite) return;
  const modal = document.getElementById("verify-invite-modal");
  document.getElementById("verify-invite-desc").textContent =
    `${invite.name} (${invite.email}) will join as ${invite.role} once verified.`;
  const codeInput = document.getElementById("vi-code");
  codeInput.value = "";
  codeInput.style.borderColor = "";
  modal.dataset.inviteId = inviteId;
  modal.hidden = false;
  document.getElementById("vi-code").focus();
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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const inviteId = modal.dataset.inviteId;
    const codeEntered = document.getElementById("vi-code").value.trim();
    const result = VetraAdmin.verifyTeamInvite(inviteId, codeEntered);

    if (!result.ok) {
      const input = document.getElementById("vi-code");
      input.style.borderColor = "#e0475c";
      input.focus();
      return;
    }

    close();
    renderTeam();
    renderPendingInvites();
    AdminUI.info({
      title: "Admin added",
      bodyHtml: `<span class="confirm-modal-target">${result.member.name}</span> is verified and now has ${result.member.role} access to the console.`,
    });
  });
}
