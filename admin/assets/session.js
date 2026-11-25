/* =========================================================
   VETRA: Admin real session guard.
   Every admin page except login.html needs a real signed-in admin
   session, there's no guest concept here, unlike the customer app.
   Redirects to login.html when there's no token, same pattern as
   vendor/assets/interactions.js's requireVendorSession().

   Returns the real signed-in admin ({id, name, email, adminRole,
   permissions}) from VetraAPI.getUser('admin') so pages can gate UI.
   ========================================================= */

function requireAdminSession() {
  if (typeof VetraAPI === "undefined" || !VetraAPI.getToken("admin")) {
    window.location.href = "login.html";
    return null;
  }
  return VetraAPI.getUser("admin");
}

/* ---------- Permission-based UI gating ----------
   Every gated route also checks the permission server-side
   (requirePermission, backend/src/middleware/auth.js), so this is UI
   polish, not the security boundary. Buttons an admin can't use are
   left out rather than shown disabled, so each page shows what that
   admin can actually do.

   `permissions` comes from sign-in and is refreshed from /auth/me on
   every page load below, so a role or personal permission change made
   by a Super Admin shows up on the next page the admin opens. */

// What each built-in role could do before permissions were stored on the
// account, for a session cached before this version (refreshed below).
const LEGACY_ROLE_PERMISSIONS = {
  Moderator: [
    "customers.status", "customers.contact", "vendors.status", "vendors.kyc", "vendors.contact",
    "vendors.payout_account", "products.remove", "users.ban", "devices.unban", "reports.resolve",
    "deliveries.dispatch", "riders.manage",
  ],
};

function isSuperAdmin() {
  const me = VetraAPI.getUser("admin");
  return !!me && me.adminRole === "Super Admin";
}

function adminPermissionList() {
  const me = VetraAPI.getUser("admin");
  if (!me) return [];
  if (Array.isArray(me.permissions)) return me.permissions;
  return LEGACY_ROLE_PERMISSIONS[me.adminRole] || [];
}

/** True if the signed-in admin holds this permission (Super Admins hold all). */
function can(key) {
  return isSuperAdmin() || adminPermissionList().includes(key);
}

// Kept for older callers: "can review and act on accounts".
function canModerate() {
  return can("customers.status") || can("vendors.status");
}

function applyPermissionVisibility() {
  document.querySelectorAll("[data-permission]").forEach((el) => {
    el.hidden = !can(el.dataset.permission);
  });
  document.querySelectorAll("[data-super-admin-only]").forEach((el) => {
    el.hidden = !isSuperAdmin();
  });
}

// Pulls the current role and permissions; if they changed since this
// page was rendered, the stored session is updated and the page reloads
// once so every gate reflects the new access.
async function refreshAdminPermissions() {
  if (typeof VetraAPI === "undefined" || !VetraAPI.getToken("admin")) return;
  const before = VetraAPI.getUser("admin");
  if (!before) return;
  let fresh;
  try {
    fresh = await VetraAPI.request("/auth/me", { method: "GET", role: "admin" });
  } catch (e) {
    return; // a signed-out session is handled by api-client.js
  }
  const perms = Array.isArray(fresh.permissions) ? fresh.permissions : [];
  const same =
    before.adminRole === fresh.admin_role &&
    Array.isArray(before.permissions) &&
    before.permissions.length === perms.length &&
    perms.every((p) => before.permissions.includes(p));
  const reloadKey = "vetra_admin_perm_reload";
  if (same) {
    try {
      sessionStorage.removeItem(reloadKey);
    } catch (e) {
      /* ignore */
    }
    return;
  }
  VetraAPI.setSession("admin", VetraAPI.getToken("admin"), { ...before, adminRole: fresh.admin_role, permissions: perms });
  try {
    if (sessionStorage.getItem(reloadKey) === location.pathname) return;
    sessionStorage.setItem(reloadKey, location.pathname);
  } catch (e) {
    return;
  }
  location.reload();
}

document.addEventListener("DOMContentLoaded", () => {
  applyPermissionVisibility();
  if (!/login\.html$/.test(location.pathname)) refreshAdminPermissions();
});
