/* =========================================================
   VETRA — ADMIN ACTIVITY LOG (admin/activity.html)
   Full, filterable view of the audit trail every suspend/
   approve/reject/resolve/invite action across the console
   appends to (see assets/data.js logActivity()).

   Visibility rule: Super Admins can browse every admin's
   activity, and get a "filter by admin" dropdown to narrow it
   to one person. Everyone else only sees platform events (no
   admin attached) plus their own actions — see
   VetraAdmin.getVisibleActivity(). This is enforced client-side
   only, the same limitation as every other role check in this
   prototype (see DOCUMENTATION.md §9).
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll("#activity-filter-tabs .filter-tab");
  let activeFilter = "all";
  let adminFilter = "all";

  const me = VetraAdmin.getCurrentAdmin();
  const iAmSuperAdmin = me && me.role === "Super Admin";

  if (iAmSuperAdmin) {
    const wrap = document.getElementById("activity-admin-filter-wrap");
    const select = document.getElementById("activity-admin-filter");
    wrap.hidden = false;
    wrap.querySelector(".cell-sub").textContent = "Viewing the whole team's activity.";

    VetraAdmin.getTeam().forEach((admin) => {
      const opt = document.createElement("option");
      opt.value = admin.id;
      opt.textContent = admin.name;
      select.appendChild(opt);
    });

    select.addEventListener("change", () => {
      adminFilter = select.value;
      render();
    });
  } else {
    document.getElementById("activity-scope-note").hidden = false;
  }

  function render() {
    let entries = VetraAdmin.getVisibleActivity();
    if (activeFilter !== "all") {
      entries = entries.filter((a) => a.type === activeFilter);
    }
    if (iAmSuperAdmin && adminFilter !== "all") {
      entries = entries.filter((a) => a.actorId === adminFilter);
    }
    AdminUI.renderActivityFeed(document.getElementById("activity-log-feed"), entries);
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeFilter = tab.dataset.filter;
      render();
    });
  });

  render();
});
