/* =========================================================
   VETRA — ADMIN REAL SESSION GUARD
   Every admin page except login.html needs a real signed-in admin
   session — there's no guest concept here, unlike the customer app.
   Redirects to login.html when there's no token, same pattern as
   vendor/assets/interactions.js's requireVendorSession().

   Returns the real signed-in admin ({id, name, email, adminRole})
   from VetraAPI.getUser('admin') so pages can role-gate UI without
   reaching into the old VetraAdmin.getCurrentAdmin() mock.
   ========================================================= */

function requireAdminSession() {
  if (typeof VetraAPI === "undefined" || !VetraAPI.getToken("admin")) {
    window.location.href = "login.html";
    return null;
  }
  return VetraAPI.getUser("admin");
}

/* ---------- Role-based UI gating ----------
   Every moderation/management route already enforces this server-side
   (requireAdminRole(...) — see BACKEND_GUIDE.md §4 point 6's matrix),
   so this is UI polish, not the security boundary: a Support admin
   who called the route directly would still get a real 403 either
   way. Omitting the button they can't use (rather than showing it
   disabled) keeps every page honest about what that admin can
   actually do, same idiom activity.js already uses for its
   Super-Admin-only ?adminId= filter (iAmSuperAdmin). */
function canModerate() {
  const me = VetraAPI.getUser("admin");
  return !!me && me.adminRole !== "Support";
}

function isSuperAdmin() {
  const me = VetraAPI.getUser("admin");
  return !!me && me.adminRole === "Super Admin";
}
