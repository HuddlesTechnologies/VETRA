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
  wireAddAdminModal();
  wireVerifyInviteModal();

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
  document.getElementById("verify-invite-mock-code").textContent = invite.code;
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
  const resendBtn = document.getElementById("verify-invite-resend");
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

  resendBtn.addEventListener("click", () => {
    const inviteId = modal.dataset.inviteId;
    const invite = VetraAdmin.resendInviteCode(inviteId);
    if (!invite) return;
    document.getElementById("verify-invite-mock-code").textContent = invite.code;
    document.getElementById("vi-code").value = "";
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
