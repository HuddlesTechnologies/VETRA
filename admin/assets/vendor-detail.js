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
  document.getElementById("vd-joined").textContent = VetraAdmin.formatDate(vendor.joined);
  document.getElementById("vd-last-login").textContent = VetraAdmin.formatDateWithRelative(vendor.lastLogin);

  renderStats(vendor);
  renderActions(vendor);
  renderKyc(vendor);
  renderOrders(vendor);
  renderReports(vendor);
  renderActivity(vendor);
}

// "completed" reads as "delivered" here, matching the label customers and
// vendors already see on their own order-tracking pages.
const ORDER_STATUS_LABEL = {
  pending: "pending",
  processing: "processing",
  shipped: "shipped",
  "out-for-delivery": "out for delivery",
  completed: "delivered",
  cancelled: "cancelled",
};

function renderOrders(vendor) {
  const section = document.getElementById("vd-orders-section");
  const list = document.getElementById("vd-orders-list");
  const orders = VetraAdmin.getOrdersForVendor(vendor.id);

  if (!orders.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  list.innerHTML = orders
    .slice()
    .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt))
    .map((o) => {
      const customer = VetraAdmin.getCustomer(o.customerId);
      const trackingLine =
        o.carrier || o.trackingNumber
          ? `<p class="order-tracking-line">${[o.carrier, o.trackingNumber].filter(Boolean).join(" · ")}</p>`
          : "";
      return `
      <div class="order-item">
        <div class="stat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"></path><path d="M8 7h8M8 11h8M8 15h5"></path></svg>
        </div>
        <div class="order-info">
          <p class="order-id">${o.item}</p>
          <p class="order-meta">${customer ? customer.name : "Unknown customer"} &middot; ${VetraAdmin.formatDate(o.placedAt)}</p>
          ${trackingLine}
        </div>
        <div class="order-side">
          <p class="order-amount">${VetraAdmin.formatNaira(o.amount)}</p>
          <span class="status-pill ${o.status}">${ORDER_STATUS_LABEL[o.status] || o.status}</span>
        </div>
      </div>
    `;
    })
    .join("");
}

// ---------------- Business Verification (KYC) ----------------
const KYC_LABEL = {
  verified: "verified",
  pending: "pending review",
  rejected: "rejected",
  not_submitted: "not submitted",
};

// Shows the actual document, not just its filename — an admin asked to
// "Verify Documents" couldn't previously see anything to verify, only a
// filename string. Clicking the thumbnail opens the full image in a new
// tab. `url` points at a shared placeholder image (see
// admin/assets/images/kyc-samples/ — clearly watermarked "DEMO / SAMPLE"
// since this prototype has no real uploaded-file storage to point at
// instead) rather than a distinct file per vendor.
function docChip(fileName, url) {
  if (!fileName) return `<span class="cell-sub">Not uploaded</span>`;
  if (!url) {
    return `
      <span class="doc-chip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        ${fileName}
      </span>
    `;
  }
  return `
    <a class="kyc-doc-preview" href="${url}" target="_blank" rel="noopener noreferrer">
      <img src="${url}" alt="${fileName}" loading="lazy" />
      <span class="doc-chip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        ${fileName}
      </span>
    </a>
  `;
}

function renderKyc(vendor) {
  const kyc = vendor.kyc || { status: "not_submitted" };
  const badge = document.getElementById("vd-kyc-badge");
  badge.textContent = KYC_LABEL[kyc.status] || kyc.status;
  badge.className = `badge ${kyc.status === "verified" ? "active" : kyc.status === "rejected" ? "suspended" : "pending"}`;

  const body = document.getElementById("vd-kyc-body");

  if (kyc.status === "not_submitted") {
    body.innerHTML = `<p class="table-empty">This vendor hasn't submitted verification documents yet — nothing to review.</p>`;
    return;
  }

  body.innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">CAC Registration Number</label>
        <p class="cell-title">${kyc.cacNumber || "—"}</p>
      </div>
      <div class="form-group">
        <label class="form-label">Submitted</label>
        <p class="cell-title">${kyc.submittedAt ? VetraAdmin.formatDate(kyc.submittedAt) : "—"}</p>
      </div>
      <div class="form-group">
        <label class="form-label">Valid ID</label>
        ${docChip(kyc.idDocumentName, kyc.idDocumentUrl)}
      </div>
      <div class="form-group">
        <label class="form-label">CAC Certificate</label>
        ${docChip(kyc.cacDocumentName, kyc.cacDocumentUrl)}
      </div>
    </div>
    ${
      kyc.status === "pending"
        ? `<div class="table-actions" style="margin-top: 14px;">
             <button class="btn-approve" data-kyc-action="verify">Verify Documents</button>
             <button class="btn-reject" data-kyc-action="reject">Reject</button>
           </div>`
        : kyc.reviewedAt
        ? `<p class="cell-sub" style="margin-top: 10px;">Reviewed ${VetraAdmin.formatDate(kyc.reviewedAt)}</p>`
        : ""
    }
  `;

  body.querySelector('[data-kyc-action="verify"]')?.addEventListener("click", () => {
    AdminUI.confirm({
      title: "Verify business documents",
      bodyHtml: `Mark <span class="confirm-modal-target">${vendor.store}</span>'s ID and CAC documents as verified?`,
      confirmLabel: "Verify",
      onConfirm: () => {
        VetraAdmin.setVendorKycStatus(vendor.id, "verified");
        render(VetraAdmin.getVendor(vendor.id));
      },
    });
  });

  body.querySelector('[data-kyc-action="reject"]')?.addEventListener("click", () => {
    AdminUI.confirm({
      title: "Reject business documents",
      bodyHtml: `Reject <span class="confirm-modal-target">${vendor.store}</span>'s submitted documents? They'll need to resubmit before their store can be approved.`,
      confirmLabel: "Reject",
      danger: true,
      showReason: true,
      onConfirm: (reason) => {
        VetraAdmin.setVendorKycStatus(vendor.id, "rejected", reason);
        render(VetraAdmin.getVendor(vendor.id));
      },
    });
  });
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
          <p>Filed ${VetraAdmin.formatDate(r.date)}${r.attendedBy ? ` · Attended by <span class="activity-actor">${r.attendedBy}</span>` : ""}</p>
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
