/* =========================================================
   VETRA: Admin roles and permissions (admin/settings.html).

   - Admin Roles card: every role, how many permissions it carries and
     who's in it. Super Admins create roles, edit any role's
     permissions (except Super Admin itself, which always has all of
     them), rename them, and delete empty ones.
   - Per-admin permissions: from the Admin Team list, a Super Admin can
     give one admin extra permissions their role doesn't have, or take
     some of their role's away. Saved as personal grants/denials
     (PUT /api/admin/team/:id/permissions).

   The routes enforce all of this server-side (backend/src/routes/
   admin.routes.js, "Admin roles and permissions"); this file is only
   the editor.
   ========================================================= */

const AdminRoles = (() => {
  const esc = (v) => VetraAPI.escapeHtml(v ?? "");
  const api = (path, opts = {}) => VetraAPI.request(path, { role: "admin", ...opts });

  let catalog = []; // [{key, group, label}]
  let roles = []; // [{name, description, isSystem, memberCount, permissions}]
  let loaded = null;

  function load(force) {
    if (!loaded || force) {
      loaded = Promise.all([api("/admin/permissions"), api("/admin/roles")]).then(([perms, roleRows]) => {
        catalog = perms.permissions || [];
        roles = roleRows || [];
        return { catalog, roles };
      });
      loaded.catch(() => {
        loaded = null;
      });
    }
    return loaded;
  }

  const roleByName = (name) => roles.find((r) => r.name === name);

  /** <option>s for every role, `selected` picked. */
  function roleOptions(selected) {
    const list = roles.length ? roles : [{ name: selected }];
    return list
      .map((r) => `<option value="${esc(r.name)}" ${r.name === selected ? "selected" : ""}>${esc(r.name)}</option>`)
      .join("");
  }

  function groupedCatalog() {
    const groups = [];
    catalog.forEach((p) => {
      let g = groups.find((x) => x.name === p.group);
      if (!g) groups.push((g = { name: p.group, items: [] }));
      g.items.push(p);
    });
    return groups;
  }

  // Checkbox list grouped by area. `state(key)` returns
  // { checked, note } per permission; `disabled` locks every box.
  function permissionChecklist(state, { disabled = false } = {}) {
    return groupedCatalog()
      .map(
        (g) => `
        <fieldset class="permission-group">
          <legend>${esc(g.name)}</legend>
          ${g.items
            .map((p) => {
              const s = state(p.key);
              return `
              <label class="permission-item">
                <input type="checkbox" value="${esc(p.key)}" ${s.checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
                <span>${esc(p.label)}</span>
                ${s.note ? `<span class="permission-note">${esc(s.note)}</span>` : ""}
              </label>`;
            })
            .join("")}
        </fieldset>`
      )
      .join("");
  }

  const checkedKeys = (container) =>
    [...container.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);

  function wireModal(modal) {
    const close = () => {
      modal.hidden = true;
    };
    modal.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", close));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) close();
    });
    return close;
  }

  /* ---------------- Admin Roles card ---------------- */

  async function renderRoles() {
    const list = document.getElementById("admin-roles-list");
    if (!list) return;
    try {
      await load(true);
    } catch (err) {
      list.innerHTML = `<p class="table-empty">Couldn't load roles: ${esc(err.message)}</p>`;
      return;
    }
    const manage = isSuperAdmin();
    const total = catalog.length;
    list.innerHTML = roles
      .map(
        (r) => `
      <div class="team-row role-row">
        <div>
          <p class="cell-title">${esc(r.name)}${r.isSystem ? ` <span class="badge active" style="margin-left: 6px;">System</span>` : ""}</p>
          <p class="cell-sub">${r.description ? `${esc(r.description)} · ` : ""}${
            r.isSystem ? "All permissions" : r.permissions.length ? `${r.permissions.length} of ${total} permissions` : "View only"
          } · ${r.memberCount} ${r.memberCount === 1 ? "admin" : "admins"}</p>
        </div>
        <div class="table-actions">
          <button class="btn-view" data-role-action="${manage && !r.isSystem ? "edit" : "view"}" data-role="${esc(r.name)}">${
            manage && !r.isSystem ? "Edit" : "View"
          }</button>
          ${
            manage && !r.isSystem
              ? `<button class="btn-suspend" data-role-action="delete" data-role="${esc(r.name)}" ${
                  r.memberCount ? 'disabled title="Move its admins to another role first"' : ""
                }>Delete</button>`
              : ""
          }
        </div>
      </div>`
      )
      .join("");

    list.onclick = (e) => {
      const btn = e.target.closest("[data-role-action]");
      if (!btn || btn.disabled) return;
      const role = roleByName(btn.dataset.role);
      if (!role) return;
      if (btn.dataset.roleAction === "delete") confirmDeleteRole(role);
      else openRoleModal(role, { readOnly: btn.dataset.roleAction === "view" });
    };
    fillInviteRoleSelect();
  }

  function fillInviteRoleSelect() {
    const select = document.getElementById("aa-role");
    if (!select || !roles.length) return;
    const current = select.value || "Moderator";
    select.innerHTML = roles
      .map((r) => {
        const what = r.isSystem
          ? "full access, including managing admins"
          : r.description || (r.permissions.length ? `${r.permissions.length} permissions` : "view only");
        return `<option value="${esc(r.name)}">${esc(r.name)}, ${esc(what)}</option>`;
      })
      .join("");
    select.value = roleByName(current) ? current : roles.find((r) => !r.isSystem)?.name || roles[0].name;
  }

  let roleModalState = null;

  function openRoleModal(role, { readOnly = false } = {}) {
    const modal = document.getElementById("role-modal");
    if (!modal) return;
    roleModalState = { original: role ? role.name : null };
    const isSystem = role && role.isSystem;
    const locked = readOnly || isSystem;
    document.getElementById("role-modal-title").textContent = role ? (locked ? role.name : `Edit ${role.name}`) : "New Role";
    const nameInput = document.getElementById("role-name");
    const descInput = document.getElementById("role-description");
    nameInput.value = role ? role.name : "";
    descInput.value = role ? role.description : "";
    nameInput.disabled = descInput.disabled = locked;
    const granted = new Set(role ? role.permissions : []);
    document.getElementById("role-permissions").innerHTML = permissionChecklist(
      (key) => ({ checked: isSystem || granted.has(key) }),
      { disabled: locked }
    );
    document.getElementById("role-save-btn").hidden = locked;
    modal.hidden = false;
    if (!locked) nameInput.focus();
  }

  function wireRoleModal() {
    const modal = document.getElementById("role-modal");
    const form = document.getElementById("role-form");
    if (!modal || !form) return;
    const close = wireModal(modal);
    const addBtn = document.getElementById("add-role-btn");
    if (addBtn) addBtn.addEventListener("click", () => openRoleModal(null));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("role-name").value.trim();
      const description = document.getElementById("role-description").value.trim();
      const permissions = checkedKeys(document.getElementById("role-permissions"));
      if (name.length < 3) {
        AdminUI.info({ title: "Name needed", bodyHtml: "Give the role a name of at least 3 characters." });
        return;
      }
      const saveBtn = document.getElementById("role-save-btn");
      saveBtn.disabled = true;
      try {
        const original = roleModalState && roleModalState.original;
        if (original) {
          await api(`/admin/roles/${encodeURIComponent(original)}`, {
            method: "PATCH",
            body: { name, description, permissions },
          });
        } else {
          await api("/admin/roles", { method: "POST", body: { name, description, permissions } });
        }
        close();
        await renderRoles();
        if (typeof renderTeam === "function") await renderTeam();
      } catch (err) {
        AdminUI.info({ title: "Couldn't save role", bodyHtml: esc(err.message) });
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  function confirmDeleteRole(role) {
    AdminUI.confirm({
      title: "Delete role",
      bodyHtml: `Delete the <span class="confirm-modal-target">${esc(role.name)}</span> role? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        try {
          await api(`/admin/roles/${encodeURIComponent(role.name)}`, { method: "DELETE" });
          await renderRoles();
        } catch (err) {
          AdminUI.info({ title: "Couldn't delete role", bodyHtml: esc(err.message) });
        }
      },
    });
  }

  /* ---------------- One admin's permissions ---------------- */

  let memberState = null;

  function renderMemberChecklist() {
    const { rolePerms, checked } = memberState;
    document.getElementById("member-permissions").innerHTML = permissionChecklist((key) => {
      const inRole = rolePerms.has(key);
      const on = checked.has(key);
      return {
        checked: on,
        note: on && !inRole ? "Extra" : !on && inRole ? "Removed" : "",
      };
    });
  }

  async function openMemberPermissions(member, onSaved) {
    const modal = document.getElementById("member-perms-modal");
    if (!modal) return;
    try {
      await load();
    } catch (err) {
      AdminUI.info({ title: "Couldn't load permissions", bodyHtml: esc(err.message) });
      return;
    }
    const role = roleByName(member.admin_role);
    const rolePerms = new Set(role ? role.permissions : []);
    const checked = new Set(rolePerms);
    (member.grants || []).forEach((k) => checked.add(k));
    (member.denies || []).forEach((k) => checked.delete(k));
    memberState = { member, rolePerms, checked, onSaved };

    document.getElementById("member-perms-title").textContent = `${member.name}'s permissions`;
    document.getElementById("member-perms-intro").innerHTML =
      `Starts from the <strong>${esc(member.admin_role)}</strong> role. Tick anything extra they need, or untick what they shouldn't have. ` +
      `Changes apply to ${esc(member.name)} only, and take effect on the next page they open.`;
    renderMemberChecklist();
    modal.hidden = false;
  }

  function wireMemberModal() {
    const modal = document.getElementById("member-perms-modal");
    const form = document.getElementById("member-perms-form");
    if (!modal || !form) return;
    const close = wireModal(modal);
    const list = document.getElementById("member-permissions");

    list.addEventListener("change", (e) => {
      const box = e.target.closest('input[type="checkbox"]');
      if (!box || !memberState) return;
      if (box.checked) memberState.checked.add(box.value);
      else memberState.checked.delete(box.value);
      renderMemberChecklist();
    });

    document.getElementById("member-perms-reset").addEventListener("click", () => {
      if (!memberState) return;
      memberState.checked = new Set(memberState.rolePerms);
      renderMemberChecklist();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!memberState) return;
      const { member, rolePerms, checked, onSaved } = memberState;
      const grants = [...checked].filter((k) => !rolePerms.has(k));
      const denies = [...rolePerms].filter((k) => !checked.has(k));
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await api(`/admin/team/${member.id}/permissions`, { method: "PUT", body: { grants, denies } });
        close();
        if (onSaved) await onSaved();
      } catch (err) {
        AdminUI.info({ title: "Couldn't save permissions", bodyHtml: esc(err.message) });
      } finally {
        btn.disabled = false;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("admin-roles-section")) return;
    wireRoleModal();
    wireMemberModal();
    renderRoles();
  });

  return { load, roleOptions, roleByName, openMemberPermissions, renderRoles };
})();
