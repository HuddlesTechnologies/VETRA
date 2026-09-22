/* =========================================================
   VETRA — ADMIN DASHBOARD (admin/dashboard.html, real backend)
   Renders the KPI stat grid, recent-activity feed, and pending-
   vendor-applications preview table from GET /api/admin/stats,
   /activity, and /vendors?status=pending.
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;

  await Promise.all([renderStats(), renderActivity(), renderPendingVendors(), renderKycManualReview()]);
});

async function renderStats() {
  const grid = document.getElementById("admin-stats");
  if (!grid) return;

  let s;
  try {
    s = await VetraAPI.request("/admin/stats", { method: "GET", role: "admin" });
  } catch (err) {
    grid.innerHTML = `<p class="table-empty">Couldn't load stats: ${err.message}</p>`;
    return;
  }
  const manualReviewCount = document.getElementById("dashboard-kyc-review-count");
  if (manualReviewCount) manualReviewCount.textContent = s.kycManualReview.toLocaleString();

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
      value: s.platformOrders.toLocaleString(),
      tint: "blue",
      icon: '<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"></path><path d="M8 7h8M8 11h8M8 15h5"></path>',
    },
    {
      label: "Platform Revenue",
      value: formatNaira(s.platformRevenue),
      tint: "green",
      icon: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h3v-4z"></path>',
    },
    {
      label: "Suspended Accounts",
      value: s.suspendedAccounts.toLocaleString(),
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

async function renderActivity() {
  const container = document.getElementById("dashboard-activity-feed");
  if (!container) return;

  try {
    // Role-scoped server-side already (Super Admin sees everything;
    // Moderator/Support see platform events + their own actions only) —
    // see backend/src/routes/admin.routes.js's GET /activity.
    const rows = await VetraAPI.request("/admin/activity", { method: "GET", role: "admin" });
    const entries = rows.slice(0, 6).map((r) => ({
      type: r.type,
      message: r.message,
      actorName: r.actor_name || null,
      time: r.created_at,
    }));
    AdminUI.renderActivityFeed(container, entries);
  } catch (err) {
    container.innerHTML = `<p class="table-empty">Couldn't load activity: ${err.message}</p>`;
  }
}

let lastRenderedPendingVendors = [];

async function renderKycManualReview() {
  const tbody = document.querySelector("#dashboard-kyc-review-table tbody");
  const countEl = document.getElementById("dashboard-kyc-review-count");
  if (!tbody || !countEl) return;
  try {
    const rows = await VetraAPI.request("/admin/vendors?kycStatus=manual_review", { method: "GET", role: "admin" });
    tbody.innerHTML = rows.length
      ? rows.slice(0, 6).map((vendor) => `
          <tr>
            <td>
              <p class="cell-title">${VetraAPI.escapeHtml(vendor.store_name || "—")}</p>
              <p class="cell-sub">${VetraAPI.escapeHtml(vendor.name || "—")}</p>
            </td>
            <td class="cell-muted">${VetraAPI.escapeHtml(vendor.kyc_provider_reason || "Provider verification failed.")}</td>
            <td><a class="btn-view" href="vendor-detail.html?id=${vendor.id}" style="text-decoration: none;">Review</a></td>
          </tr>
        `).join("")
      : `<tr><td colspan="3" class="table-empty">No KYC cases need manual review.</td></tr>`;
  } catch (err) {
    countEl.textContent = "!";
    tbody.innerHTML = `<tr><td colspan="3" class="table-empty">Couldn't load KYC review cases: ${err.message}</td></tr>`;
  }
}

async function renderPendingVendors() {
  const tbody = document.querySelector("#dashboard-pending-table tbody");
  if (!tbody) return;

  let pending;
  try {
    pending = await VetraAPI.request("/admin/vendors?status=pending", { method: "GET", role: "admin" });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">Couldn't load pending vendors: ${err.message}</td></tr>`;
    return;
  }

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
          <span class="cell-avatar">${VetraAdmin.initials(v.store_name)}</span>
          <div>
            <p class="cell-title">${VetraAPI.escapeHtml(v.store_name || "")}</p>
            <p class="cell-sub">${VetraAPI.escapeHtml(v.name || "")}</p>
          </div>
        </div>
      </td>
      <td class="cell-muted">${v.store_category || "—"}</td>
      <td class="cell-muted">Pending review</td>
      <td>
        <div class="table-actions">
          ${
            canModerate()
              ? `<button class="btn-approve" data-action="approve" data-id="${v.id}">Approve</button>
                 <button class="btn-reject" data-action="reject" data-id="${v.id}">Reject</button>`
              : `<span class="cell-muted">View only</span>`
          }
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  // `pending` here is a fresh array each call — keep a module-level
  // reference the (once-attached, see below) click handler can read.
  lastRenderedPendingVendors = pending;
}

// Attached once, not inside renderPendingVendors() — that function re-runs
// after every approve/reject, and re-innerHTML'ing tbody doesn't replace
// the tbody element itself, so a listener attached inside it would stack
// a new copy on every re-render (the original mock had this same bug:
// a second action after the first would fire once per prior render).
document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.querySelector("#dashboard-pending-table tbody");
  if (!tbody) return;

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const vendor = lastRenderedPendingVendors.find((v) => v.id === id);
    if (!vendor) return;
    const storeName = VetraAPI.escapeHtml(vendor.store_name || "");

    async function setStatus(status, reason) {
      try {
        await VetraAPI.request(`/admin/vendors/${id}/status`, {
          method: "PATCH", role: "admin", body: { status, reason },
        });
        await Promise.all([renderPendingVendors(), renderStats(), renderActivity()]);
      } catch (err) {
        AdminUI.info({ title: "Couldn't update vendor", bodyHtml: err.message });
      }
    }

    if (btn.dataset.action === "approve") {
      AdminUI.confirm({
        title: "Approve vendor",
        bodyHtml: `Approve <span class="confirm-modal-target">${storeName}</span>? Their store and listings will go live immediately.`,
        confirmLabel: "Approve",
        onConfirm: () => setStatus("active"),
      });
    } else if (btn.dataset.action === "reject") {
      AdminUI.confirm({
        title: "Reject vendor application",
        bodyHtml: `Reject <span class="confirm-modal-target">${storeName}</span>'s application? They can re-apply later.`,
        confirmLabel: "Reject",
        danger: true,
        showReason: true,
        onConfirm: (reason) => setStatus("rejected", reason),
      });
    }
  });
});
