/* =========================================================
   VETRA — ADMIN DASHBOARD (admin/dashboard.html)
   Renders the KPI stat grid, the recent-activity feed, and the
   pending-vendor-applications preview table from VetraAdmin's
   mock data layer (assets/data.js).
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  renderStats();
  renderActivity();
  renderPendingVendors();
});

function renderStats() {
  const grid = document.getElementById("admin-stats");
  if (!grid) return;
  const s = VetraAdmin.getStats();

  const cards = [
    {
      label: "Total Customers",
      value: s.totalCustomers.toLocaleString(),
      tint: "blue",
      sub: `${s.suspendedCustomers} suspended`,
      icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle>',
    },
    {
      label: "Total Vendors",
      value: s.totalVendors.toLocaleString(),
      tint: "purple",
      sub: `${s.pendingVendors} pending approval`,
      icon: '<path d="M3 9l1.5-5h15L21 9"></path><path d="M4 9v10a1 1 0 0 0 1 1h4v-6h6v6h4a1 1 0 0 0 1-1V9"></path>',
    },
    {
      label: "Platform Orders",
      value: s.totalOrders.toLocaleString(),
      tint: "blue",
      icon: '<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"></path><path d="M8 7h8M8 11h8M8 15h5"></path>',
    },
    {
      label: "Platform Revenue",
      value: VetraAdmin.formatNaira(s.totalRevenue),
      tint: "green",
      icon: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h3v-4z"></path>',
    },
    {
      label: "Suspended Accounts",
      value: (s.suspendedCustomers + s.suspendedVendors).toLocaleString(),
      tint: "red",
      sub: `${s.suspendedCustomers} customers · ${s.suspendedVendors} vendors`,
      icon: '<circle cx="12" cy="12" r="10"></circle><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"></line>',
    },
    {
      label: "Open Reports",
      value: s.openReports.toLocaleString(),
      tint: "amber",
      icon: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="4"></line>',
    },
  ];

  grid.innerHTML = cards
    .map(
      (c) => `
    <div class="stat-card">
      <div class="stat-card-head">
        <p class="stat-label">${c.label}</p>
        <span class="stat-icon tint-${c.tint}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${c.icon}</svg>
        </span>
      </div>
      <p class="stat-value">${c.value}</p>
      ${c.sub ? `<span class="stat-trend" style="color: var(--muted)">${c.sub}</span>` : ""}
    </div>
  `
    )
    .join("");
}

function renderActivity() {
  const container = document.getElementById("dashboard-activity-feed");
  if (!container) return;
  // Non-Super-Admins only see platform events + their own actions here —
  // see VetraAdmin.getVisibleActivity() for the rule.
  AdminUI.renderActivityFeed(container, VetraAdmin.getVisibleActivity().slice(0, 6));
}

function renderPendingVendors() {
  const tbody = document.querySelector("#dashboard-pending-table tbody");
  if (!tbody) return;
  const pending = VetraAdmin.getVendors().filter((v) => v.status === "pending");

  if (!pending.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No pending vendor applications.</td></tr>`;
    return;
  }

  tbody.innerHTML = pending
    .slice(0, 4)
    .map(
      (v) => `
    <tr data-vendor-id="${v.id}">
      <td>
        <div class="cell-entity">
          <span class="cell-avatar">${VetraAdmin.initials(v.store)}</span>
          <div>
            <p class="cell-title">${v.store}</p>
            <p class="cell-sub">${v.owner}</p>
          </div>
        </div>
      </td>
      <td class="cell-muted">${v.category}</td>
      <td class="cell-muted">Pending review</td>
      <td>
        <div class="table-actions">
          <button class="btn-approve" data-action="approve" data-id="${v.id}">Approve</button>
          <button class="btn-reject" data-action="reject" data-id="${v.id}">Reject</button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const vendor = VetraAdmin.getVendor(id);
    if (!vendor) return;

    if (btn.dataset.action === "approve") {
      AdminUI.confirm({
        title: "Approve vendor",
        bodyHtml: `Approve <span class="confirm-modal-target">${vendor.store}</span>? Their store and listings will go live immediately.`,
        confirmLabel: "Approve",
        onConfirm: () => {
          VetraAdmin.setVendorStatus(id, "active");
          renderPendingVendors();
          renderStats();
          renderActivity();
        },
      });
    } else if (btn.dataset.action === "reject") {
      AdminUI.confirm({
        title: "Reject vendor application",
        bodyHtml: `Reject <span class="confirm-modal-target">${vendor.store}</span>'s application? They can re-apply later.`,
        confirmLabel: "Reject",
        danger: true,
        showReason: true,
        onConfirm: (reason) => {
          VetraAdmin.setVendorStatus(id, "rejected", reason);
          renderPendingVendors();
          renderStats();
          renderActivity();
        },
      });
    }
  });
}
