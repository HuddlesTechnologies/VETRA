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
