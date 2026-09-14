/* =========================================================
   VETRA — ADMIN REPORTS & DISPUTES (admin/reports.html)
   Renders VetraAdmin.getReports() as a moderation queue. Each
   report can be resolved or dismissed; a report against a
   vendor or customer also offers a direct "Suspend Account"
   shortcut so a moderator doesn't have to leave this page to
   act on what they just reviewed.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll("#report-filter-tabs .filter-tab");
  const params = new URLSearchParams(window.location.search);
  const initialFilter = params.get("filter");
  let activeFilter = "all";
  if (initialFilter && ["open", "resolved", "dismissed"].includes(initialFilter)) {
    activeFilter = initialFilter;
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.filter === initialFilter));
  }

  function targetLabel(r) {
    if (r.type === "customer") return "Customer";
    if (r.type === "vendor") return "Vendor";
    return "Product listing";
  }

  function render() {
    let rows = VetraAdmin.getReports();
    if (activeFilter !== "all") {
      rows = rows.filter((r) => r.status === activeFilter);
    }
    // Most recent first
    rows = [...rows].sort((a, b) => new Date(b.date) - new Date(a.date));

    const list = document.getElementById("report-list");
    if (!rows.length) {
      list.innerHTML = `<p class="table-empty">No reports in this view.</p>`;
      return;
    }

    list.innerHTML = rows
      .map((r) => {
        const canSuspend = (r.type === "customer" || r.type === "vendor") && r.status === "open";
        return `
      <div class="report-card" data-report-id="${r.id}">
        <div class="report-card-head">
          <div>
            <h4>${r.targetName}</h4>
            <p>${targetLabel(r)} &middot; reported by ${r.reporter}</p>
          </div>
          <span class="badge ${r.status}">${r.status}</span>
        </div>
        <p class="report-reason">${r.reason}</p>
        <div class="report-meta-row">
          <span>Filed ${VetraAdmin.formatDate(r.date)}</span>
          <span>Type: ${targetLabel(r)}</span>
          ${r.attendedBy ? `<span>Attended by <span class="activity-actor">${r.attendedBy}</span></span>` : ""}
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

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeFilter = tab.dataset.filter;
      render();
    });
  });

  document.getElementById("report-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const report = VetraAdmin.getReport(id);
    if (!report) return;
    const action = btn.dataset.action;

    if (action === "resolve") {
      AdminUI.confirm({
        title: "Mark report resolved",
        bodyHtml: `Mark the report on <span class="confirm-modal-target">${report.targetName}</span> as resolved?`,
        confirmLabel: "Mark resolved",
        onConfirm: () => {
          VetraAdmin.setReportStatus(id, "resolved");
          render();
        },
      });
    } else if (action === "dismiss") {
      AdminUI.confirm({
        title: "Dismiss report",
        bodyHtml: `Dismiss the report on <span class="confirm-modal-target">${report.targetName}</span> with no action taken?`,
        confirmLabel: "Dismiss",
        onConfirm: () => {
          VetraAdmin.setReportStatus(id, "dismissed");
          render();
        },
      });
    } else if (action === "suspend") {
      const suspendLabel = report.type === "vendor" ? "store" : "account";
      AdminUI.confirm({
        title: `Suspend ${report.type}`,
        bodyHtml: `Suspend <span class="confirm-modal-target">${report.targetName}</span>'s ${suspendLabel} based on this report? This also marks the report resolved.`,
        confirmLabel: "Suspend & resolve",
        danger: true,
        showReason: true,
        onConfirm: (reason) => {
          if (report.type === "vendor") {
            VetraAdmin.setVendorStatus(report.targetId, "suspended", reason || report.reason);
          } else {
            VetraAdmin.setCustomerStatus(report.targetId, "suspended", reason || report.reason);
          }
          VetraAdmin.setReportStatus(id, "resolved");
          render();
        },
      });
    }
  });

  render();
});
