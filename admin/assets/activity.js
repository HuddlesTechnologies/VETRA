/* =========================================================
   VETRA — ADMIN ACTIVITY LOG (admin/activity.html, real backend)
   Full, filterable view of the audit trail every admin mutation
   appends to server-side (see backend/src/utils/activityLog.js).

   Visibility rule is enforced server-side now, not just in this
   file: GET /api/admin/activity already returns only platform
   events + the caller's own actions for a Moderator/Support admin,
   and everything (optionally filtered to one admin via ?adminId=)
   for a Super Admin — see backend/src/routes/admin.routes.js.
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;

  const tabs = document.querySelectorAll("#activity-filter-tabs .filter-tab");
  let activeFilter = "all";
  let adminFilter = "all";

  const iAmSuperAdmin = me.adminRole === "Super Admin";
  const feed = document.getElementById("activity-log-feed");
  const clearAllBtn = document.getElementById("clear-activity-btn");

  if (clearAllBtn) {
    if (!iAmSuperAdmin) {
      clearAllBtn.hidden = true;
    } else {
      clearAllBtn.hidden = false;
      clearAllBtn.addEventListener("click", () => {
        AdminUI.confirm({
          title: "Clear the entire activity log?",
          bodyHtml: "This permanently deletes every entry in the audit trail — not just what's currently filtered. This can't be undone.",
          confirmLabel: "Clear everything",
          danger: true,
          onConfirm: async () => {
            try {
              await VetraAPI.request("/admin/activity", { method: "DELETE", role: "admin" });
              await load();
            } catch (err) {
              AdminUI.info({ title: "Couldn't clear activity log", bodyHtml: err.message });
            }
          },
        });
      });
    }
  }

  if (iAmSuperAdmin) {
    const wrap = document.getElementById("activity-admin-filter-wrap");
    const select = document.getElementById("activity-admin-filter");
    wrap.hidden = false;
    wrap.querySelector(".cell-sub").textContent = "Viewing the whole team's activity.";

    try {
      const team = await VetraAPI.request("/admin/team", { method: "GET", role: "admin" });
      team.forEach((admin) => {
        const opt = document.createElement("option");
        opt.value = admin.id;
        opt.textContent = admin.name;
        select.appendChild(opt);
      });
    } catch (err) {
      /* dropdown just won't have team options — the "All admins" default still works */
    }

    select.addEventListener("change", () => {
      adminFilter = select.value;
      load();
    });
  } else {
    document.getElementById("activity-scope-note").hidden = false;
  }

  async function load() {
    feed.innerHTML = `<p class="table-empty">Loading…</p>`;
    try {
      const path = iAmSuperAdmin && adminFilter !== "all"
        ? `/admin/activity?adminId=${encodeURIComponent(adminFilter)}`
        : "/admin/activity";
      const rows = await VetraAPI.request(path, { method: "GET", role: "admin" });
      let entries = rows.map((r) => ({
        id: r.id,
        type: r.type,
        message: r.message,
        actorName: r.actor_name || null,
        time: r.created_at,
      }));
      if (activeFilter !== "all") {
        entries = entries.filter((a) => a.type === activeFilter);
      }
      AdminUI.renderActivityFeed(feed, entries, (id) => {
        AdminUI.confirm({
          title: "Delete this entry?",
          bodyHtml: "This permanently removes this one entry from the audit trail. This can't be undone.",
          confirmLabel: "Delete",
          danger: true,
          onConfirm: async () => {
            try {
              await VetraAPI.request(`/admin/activity/${id}`, { method: "DELETE", role: "admin" });
              await load();
            } catch (err) {
              AdminUI.info({ title: "Couldn't delete entry", bodyHtml: err.message });
            }
          },
        });
      });
    } catch (err) {
      feed.innerHTML = `<p class="table-empty">Couldn't load activity: ${err.message}</p>`;
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeFilter = tab.dataset.filter;
      load();
    });
  });

  await load();
});
