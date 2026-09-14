/* =========================================================
   VETRA — VENDOR DETAIL (admin/vendor-detail.html?id=<id>)
   Same shape as customer-detail.js: full store profile, stats,
   reports filed against this vendor, and their complete
   activity history. Pending vendors get Approve/Reject instead
   of Suspend/Reactivate, matching vendors.html's list view.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const vendor = id ? VetraAdmin.getVendor(id) : null;

  if (!vendor) {
    document.getElementById("vendor-not-found").hidden = false;
    document.getElementById("vendor-detail-content").hidden = true;
    return;
  }

  render(vendor);
});

function render(vendor) {
  document.title = `VETRA — Admin · ${vendor.store}`;
  document.getElementById("vd-store").textContent = vendor.store;
  document.getElementById("vd-store-2").textContent = vendor.store;
  document.getElementById("vd-owner-line").textContent = `Owned by ${vendor.owner}`;
  document.getElementById("vd-avatar").textContent = VetraAdmin.initials(vendor.store);
  document.getElementById("vd-category").textContent = vendor.category;
  document.getElementById("vd-description").textContent = vendor.description || "";

  const statusBadge = document.getElementById("vd-status-badge");
  statusBadge.textContent = vendor.status;
  statusBadge.className = `badge ${vendor.status}`;

  document.getElementById("vd-owner").textContent = vendor.owner;
  document.getElementById("vd-email").textContent = vendor.email || "—";
  document.getElementById("vd-phone").textContent = vendor.phone || "—";
  document.getElementById("vd-address").textContent = vendor.address || "—";
  document.getElementById("vd-joined").textContent = formatDate(vendor.joined);
  document.getElementById("vd-last-login").textContent = vendor.lastLogin
    ? `${formatDate(vendor.lastLogin)} (${VetraAdmin.timeAgo(vendor.lastLogin)})`
    : "—";

  renderStats(vendor);
  renderActions(vendor);
  renderReports(vendor);
  renderActivity(vendor);
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
}

function renderStats(vendor) {
  const grid = document.getElementById("vd-stats");
  grid.innerHTML = `
    <div class="stat-card">
      <p class="stat-label">Products</p>
      <p class="stat-value">${vendor.products}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Orders</p>
      <p class="stat-value">${vendor.orders}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Revenue</p>
      <p class="stat-value">${VetraAdmin.formatNaira(vendor.revenue)}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Store Status</p>
      <p class="stat-value" style="font-size: 16px; text-transform: capitalize;">${vendor.status}</p>
    </div>
  `;
}

function renderActions(vendor) {
  const wrap = document.getElementById("vd-actions");
  const resetBtn = `<button class="btn-reset" data-action="reset-password" style="padding: 10px 16px; font-size: 13px;">Reset Password</button>`;

  if (vendor.status === "pending") {
    wrap.innerHTML = `
      ${resetBtn}
      <button class="btn-approve" data-action="approve" style="padding: 10px 16px; font-size: 13px;">Approve</button>
      <button class="btn-reject" data-action="reject" style="padding: 10px 16px; font-size: 13px;">Reject</button>
    `;
  } else if (vendor.status === "suspended") {
    wrap.innerHTML = `${resetBtn}<button class="btn-activate" data-action="activate" style="padding: 10px 16px; font-size: 13px;">Reactivate Store</button>`;
  } else {
    wrap.innerHTML = `${resetBtn}<button class="btn-suspend" data-action="suspend" style="padding: 10px 16px; font-size: 13px;">Suspend Store</button>`;
  }

  wrap.querySelector('[data-action="reset-password"]').addEventListener("click", () => {
    AdminUI.confirm({
      title: "Reset password",
      bodyHtml: `Reset the password for <span class="confirm-modal-target">${vendor.owner}</span> (${vendor.store})? They'll be signed out everywhere and need to use a new temporary password to sign back in.`,
      confirmLabel: "Reset password",
      onConfirm: () => {
        const tempPassword = VetraAdmin.resetVendorPassword(vendor.id);
        AdminUI.info({
          title: "Password reset",
          bodyHtml: `
            <p style="margin: 0 0 10px; font-size: 13px; color: var(--muted);">Share this temporary password with ${vendor.owner} securely. They'll be required to set a new one at next sign-in.</p>
            <div class="reveal-panel">
              <p>Temporary password</p>
              <div class="reveal-value">${tempPassword}</div>
            </div>
          `,
        });
        renderActivity(vendor);
      },
    });
  });

  wrap.querySelectorAll('button[data-action]:not([data-action="reset-password"])').forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "approve") {
        AdminUI.confirm({
          title: "Approve vendor",
          bodyHtml: `Approve <span class="confirm-modal-target">${vendor.store}</span>? Their store and listings will go live immediately.`,
          confirmLabel: "Approve",
          onConfirm: () => {
            VetraAdmin.setVendorStatus(vendor.id, "active");
            render(VetraAdmin.getVendor(vendor.id));
          },
        });
      } else if (action === "reject") {
        AdminUI.confirm({
          title: "Reject vendor application",
          bodyHtml: `Reject <span class="confirm-modal-target">${vendor.store}</span>'s application? They can re-apply later.`,
          confirmLabel: "Reject",
          danger: true,
          showReason: true,
          onConfirm: (reason) => {
            VetraAdmin.setVendorStatus(vendor.id, "rejected", reason);
            render(VetraAdmin.getVendor(vendor.id));
          },
        });
      } else if (action === "suspend") {
        AdminUI.confirm({
          title: "Suspend vendor",
          bodyHtml: `Suspend <span class="confirm-modal-target">${vendor.store}</span>? Their store and listings will be hidden from buyers until reinstated.`,
          confirmLabel: "Suspend store",
          danger: true,
          showReason: true,
          onConfirm: (reason) => {
            VetraAdmin.setVendorStatus(vendor.id, "suspended", reason);
            render(VetraAdmin.getVendor(vendor.id));
          },
        });
      } else if (action === "activate") {
        AdminUI.confirm({
          title: "Reactivate vendor",
          bodyHtml: `Reactivate <span class="confirm-modal-target">${vendor.store}</span>? Their store and listings will go live again immediately.`,
          confirmLabel: "Reactivate",
          onConfirm: () => {
            VetraAdmin.setVendorStatus(vendor.id, "active");
            render(VetraAdmin.getVendor(vendor.id));
          },
        });
      }
    });
  });
}

function renderReports(vendor) {
  const section = document.getElementById("vd-reports-section");
  const list = document.getElementById("vd-reports-list");
  const reports = VetraAdmin.getReportsForTarget("vendor", vendor.id);

  if (!reports.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = reports
    .map(
      (r) => `
    <div class="report-card">
      <div class="report-card-head">
        <div>
          <h4>Reported by ${r.reporter}</h4>
          <p>Filed ${formatDate(r.date)}${r.attendedBy ? ` · Attended by <span class="activity-actor">${r.attendedBy}</span>` : ""}</p>
        </div>
        <span class="badge ${r.status}">${r.status}</span>
      </div>
      <p class="report-reason">${r.reason}</p>
    </div>
  `
    )
    .join("");
}

function renderActivity(vendor) {
  const entries = VetraAdmin.getActivityForTarget("vendor", vendor.id);
  AdminUI.renderActivityFeed(document.getElementById("vd-activity-feed"), entries);
}
