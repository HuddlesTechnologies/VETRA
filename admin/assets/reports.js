/* =========================================================
   VETRA — ADMIN REPORTS & DISPUTES (admin/reports.html, real backend)
   Renders GET /api/reports as a moderation queue. Every report here
   is type='vendor' in practice — see backend/src/routes/reports.routes.js's
   own comment on why nothing creates a 'customer' or 'product' report —
   so "Suspend Account" always means suspending the reported vendor's
   store, via PATCH /api/admin/vendors/:id/status.
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;

  const tabs = document.querySelectorAll("#report-filter-tabs .filter-tab");
  const params = new URLSearchParams(window.location.search);
  const initialFilter = params.get("filter");
  let activeFilter = "all";
  if (initialFilter && ["open", "resolved", "dismissed"].includes(initialFilter)) {
    activeFilter = initialFilter;
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.filter === initialFilter));
  }

  const list = document.getElementById("report-list");
  let reports = [];

  function targetLabel(r) {
    return r.type === "customer" ? "Customer" : r.type === "vendor" ? "Vendor" : "Product listing";
  }

  function reportById(id) {
    return reports.find((r) => r.id === id) || null;
  }

  function renderRows() {
    let rows = activeFilter !== "all" ? reports.filter((r) => r.status === activeFilter) : reports;

    if (!rows.length) {
      list.innerHTML = `<p class="table-empty">No reports in this view.</p>`;
      return;
    }

    list.innerHTML = rows
      .map((r) => {
        // target_status !== 'suspended' — a report against an account
        // that's already suspended (or one the admin already dealt with
        // some other way) shouldn't offer a redundant suspend action.
        const canSuspend = (r.type === "customer" || r.type === "vendor")
          && r.status === "open" && r.target_status && r.target_status !== "suspended";
        return `
      <div class="report-card" data-report-id="${r.id}">
        <div class="report-card-head">
          <div>
            <h4>${r.target_name || "Unknown"}</h4>
            <p>${targetLabel(r)} &middot; reported by ${r.reporter || "a buyer"}</p>
          </div>
          <span class="badge ${r.status}">${r.status}</span>
        </div>
        <p class="report-reason">${r.reason}</p>
        <div class="report-meta-row">
          <span>Filed ${VetraAdmin.formatDate(r.created_at)}</span>
          <span>Type: ${targetLabel(r)}</span>
          ${r.attended_by_name ? `<span>Attended by <span class="activity-actor">${r.attended_by_name}</span></span>` : ""}
        </div>
        ${
          r.status === "open"
            ? `<div class="report-actions">
                ${canSuspend ? `<button class="btn-suspend" data-action="suspend" data-id="${r.id}">Suspend Account</button>` : ""}
                <button class="btn-resolve" data-action="resolve" data-id="${r.id}">Mark Resolved</button>
                <button class="btn-dismiss" data-action="dismiss" data-id="${r.id}">Dismiss</button>
              </div>`
            : ""
        }
      </div>
    `;
      })
      .join("");
  }

  async function load() {
    list.innerHTML = `<p class="table-empty">Loading…</p>`;
    try {
      reports = await VetraAPI.request("/reports", { method: "GET", role: "admin" });
      renderRows();
    } catch (err) {
      list.innerHTML = `<p class="table-empty">Couldn't load reports: ${err.message}</p>`;
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeFilter = tab.dataset.filter;
      renderRows();
    });
  });

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const report = reportById(id);
    if (!report) return;
    const action = btn.dataset.action;

    async function setReportStatus(status) {
      await VetraAPI.request(`/reports/${id}/status`, { method: "PATCH", role: "admin", body: { status } });
    }

    if (action === "resolve") {
      AdminUI.confirm({
        title: "Mark report resolved",
        bodyHtml: `Mark the report on <span class="confirm-modal-target">${report.target_name}</span> as resolved?`,
        confirmLabel: "Mark resolved",
        onConfirm: async () => {
          try {
            await setReportStatus("resolved");
            await load();
          } catch (err) {
            AdminUI.info({ title: "Couldn't resolve report", bodyHtml: err.message });
          }
        },
      });
    } else if (action === "dismiss") {
      AdminUI.confirm({
        title: "Dismiss report",
        bodyHtml: `Dismiss the report on <span class="confirm-modal-target">${report.target_name}</span> with no action taken?`,
        confirmLabel: "Dismiss",
        onConfirm: async () => {
          try {
            await setReportStatus("dismissed");
            await load();
          } catch (err) {
            AdminUI.info({ title: "Couldn't dismiss report", bodyHtml: err.message });
          }
        },
      });
    } else if (action === "suspend") {
      const suspendLabel = report.type === "vendor" ? "store" : "account";
      AdminUI.confirm({
        title: `Suspend ${report.type}`,
        bodyHtml: `Suspend <span class="confirm-modal-target">${report.target_name}</span>'s ${suspendLabel} based on this report? This also marks the report resolved.`,
        confirmLabel: "Suspend & resolve",
        danger: true,
        showReason: true,
        onConfirm: async (reason) => {
          try {
            const endpoint = report.type === "vendor" ? "vendors" : "customers";
            await VetraAPI.request(`/admin/${endpoint}/${report.target_id}/status`, {
              method: "PATCH", role: "admin", body: { status: "suspended", reason: reason || report.reason },
            });
            await setReportStatus("resolved");
            await load();
          } catch (err) {
            AdminUI.info({ title: "Couldn't suspend account", bodyHtml: err.message });
          }
        },
      });
    }
  });

  await load();
});
