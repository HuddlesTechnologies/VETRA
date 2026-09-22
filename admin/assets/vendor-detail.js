/* =========================================================
   VETRA — VENDOR DETAIL (admin/vendor-detail.html?id=<id>, real backend)
   Same shape as customer-detail.js: full store profile, stats, real
   KYC review, real order history, real reports, and real activity —
   all from GET /api/admin/vendors/:id (+ /orders, /kyc via the same
   response) and the target-scoped /api/reports, /api/admin/activity.
   ========================================================= */

let currentVendor = null;

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    document.getElementById("vendor-not-found").hidden = false;
    document.getElementById("vendor-detail-content").hidden = true;
    return;
  }

  await loadAndRender(id);
});

async function loadAndRender(id) {
  try {
    currentVendor = await VetraAPI.request(`/admin/vendors/${id}`, { method: "GET", role: "admin" });
  } catch (err) {
    document.getElementById("vendor-not-found").hidden = false;
    document.getElementById("vendor-detail-content").hidden = true;
    return;
  }
  render(currentVendor);
}

function render(vendor) {
  document.title = `VETRA — Admin · ${vendor.store_name}`;
  document.getElementById("vd-store").textContent = vendor.store_name;
  document.getElementById("vd-store-2").textContent = vendor.store_name;
  document.getElementById("vd-owner-line").textContent = `Owned by ${vendor.name}`;
  document.getElementById("vd-avatar").textContent = VetraAdmin.initials(vendor.store_name);
  document.getElementById("vd-category").textContent = vendor.store_category || "—";
  document.getElementById("vd-description").textContent = vendor.store_description || "";

  const statusBadge = document.getElementById("vd-status-badge");
  statusBadge.textContent = vendor.status;
  statusBadge.className = `badge ${vendor.status}`;

  document.getElementById("vd-owner").textContent = vendor.name;
  document.getElementById("vd-email").textContent = vendor.email || "—";
  document.getElementById("vd-phone").textContent = vendor.phone || "—";
  document.getElementById("vd-address").textContent = vendor.address || "—";
  document.getElementById("vd-joined").textContent = VetraAdmin.formatDate(vendor.created_at);
  document.getElementById("vd-last-login").textContent = VetraAdmin.formatDateWithRelative(vendor.last_login_at);

  renderStats(vendor);
  renderActions(vendor);
  renderKyc(vendor);
  renderPayoutAccount(vendor);
  AdminUI.renderIpHistory(vendor.id, "vd-ip-history");
  renderProducts(vendor);
  renderOrders(vendor);
  renderReports(vendor);
  renderActivity(vendor);
}

function escapeAuditText(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

async function renderPayoutAccount(vendor) {
  const section = document.getElementById("vd-payout-section");
  if (!section || !canModerate()) return;
  section.hidden = false;
  const currentEl = document.getElementById("vd-payout-current");
  const historyEl = document.getElementById("vd-payout-history");
  try {
    const data = await VetraAPI.request(`/admin/vendors/${vendor.id}/payout-account`, { method: "GET", role: "admin" });
    currentEl.innerHTML = data.current
      ? `<div class="form-grid">
           <div class="form-group"><label class="form-label">Bank</label><p class="cell-title">${escapeAuditText(data.current.bankName)}</p></div>
           <div class="form-group"><label class="form-label">Account name</label><p class="cell-title">${escapeAuditText(data.current.accountName)}</p></div>
           <div class="form-group"><label class="form-label">Account number</label><p class="cell-title">${escapeAuditText(data.current.maskedAccountNumber)}</p></div>
         </div>`
      : `<p class="table-empty">No bank account is currently linked.</p>`;
    historyEl.innerHTML = data.history.length
      ? `<p class="form-label" style="margin:16px 0 8px;">Previously linked accounts</p>${data.history.map((account) => `
          <div class="activity-item">
            <div><strong>${escapeAuditText(account.bank_name)}</strong> · ${escapeAuditText(account.masked_account_number)} · ${escapeAuditText(account.account_name)}</div>
            <span>${account.unlinked_at ? `Unlinked ${VetraAdmin.formatDateTime(account.unlinked_at)}` : "Current"}</span>
          </div>`).join("")}`
      : "";
  } catch (err) {
    section.hidden = true;
  }
}

function parseJsonList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function escapeProductText(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function escapeProductAttribute(value) {
  return escapeProductText(value).replace(/"/g, "&quot;");
}

function renderProductMedia(product) {
  const images = parseJsonList(product.images).filter(Boolean);
  const imageMarkup = images.length
    ? `<div class="product-listing-images">${images.map((url) => `<a href="${escapeProductAttribute(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeProductAttribute(url)}" alt="${escapeProductAttribute(product.name)}" loading="lazy"></a>`).join("")}</div>`
    : `<p class="cell-sub">No product images uploaded.</p>`;
  const videoMarkup = product.video_url
    ? `<video class="product-listing-video" controls preload="metadata" src="${escapeProductAttribute(product.video_url)}"></video><a class="see-more" href="${escapeProductAttribute(product.video_url)}" target="_blank" rel="noopener noreferrer">Open video</a>`
    : `<p class="cell-sub">No product video uploaded.</p>`;
  return `<div class="product-listing-media"><div><label class="form-label">Images</label>${imageMarkup}</div><div><label class="form-label">Video</label>${videoMarkup}</div></div>`;
}

async function renderProducts(vendor) {
  const list = document.getElementById("vd-products-list");
  let products = [];
  try {
    products = await VetraAPI.request(`/admin/vendors/${vendor.id}/products`, { method: "GET", role: "admin" });
  } catch (err) {
    list.innerHTML = `<p class="table-empty">Couldn't load listings: ${escapeProductText(err.message)}</p>`;
    return;
  }

  if (!products.length) {
    list.innerHTML = `<p class="table-empty">This vendor has not listed any products.</p>`;
    return;
  }

  list.innerHTML = products.map((product) => {
    const keywords = parseJsonList(product.keywords);
    const canRemove = canModerate() && product.status !== "removed";
    return `
      <article class="product-listing-card ${product.status === "removed" ? "is-removed" : ""}">
        <div class="product-listing-head">
          <div>
            <h4>${escapeProductText(product.name)}</h4>
            <p class="cell-sub">${escapeProductText(product.category)} · Listed ${VetraAdmin.formatDate(product.created_at)}</p>
          </div>
          <div class="product-listing-actions">
            <span class="badge ${product.status === "active" ? "active" : product.status === "removed" ? "suspended" : "pending"}">${escapeProductText(product.status)}</span>
            ${canRemove ? `<button class="btn-remove-listing" data-remove-product="${escapeProductAttribute(product.id)}"><span aria-hidden="true">×</span> Remove Listing</button>` : ""}
          </div>
        </div>
        <div class="product-listing-details">
          <div><label class="form-label">Price</label><p class="cell-title">${formatNaira(product.price)}</p></div>
          <div><label class="form-label">Stock</label><p class="cell-title">${escapeProductText(product.stock_quantity)}</p></div>
          <div><label class="form-label">Color</label><p class="cell-title">${escapeProductText(product.color || "—")}</p></div>
          <div><label class="form-label">Storage</label><p class="cell-title">${escapeProductText(product.storage || "—")}</p></div>
          <div class="product-listing-description"><label class="form-label">Description</label><p class="cell-title">${escapeProductText(product.description || "—")}</p></div>
          <div class="product-listing-description"><label class="form-label">Keywords</label><p class="cell-title">${escapeProductText(keywords.join(", ") || "—")}</p></div>
        </div>
        ${renderProductMedia(product)}
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-remove-product]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = products.find((item) => item.id === button.dataset.removeProduct);
      AdminUI.confirm({
        title: "Remove listing",
        bodyHtml: `Remove <span class="confirm-modal-target">${escapeProductText(product.name)}</span> from this vendor's store? It will no longer be visible to buyers, but past order history will remain intact.`,
        confirmLabel: "Remove listing",
        danger: true,
        onConfirm: async () => {
          try {
            await VetraAPI.request(`/admin/vendors/${vendor.id}/products/${product.id}`, { method: "DELETE", role: "admin" });
            await renderProducts(vendor);
          } catch (err) {
            AdminUI.info({ title: "Couldn't remove listing", bodyHtml: escapeProductText(err.message) });
          }
        },
      });
    });
  });
}

// ORDER_STATUS_LABEL and the hyphen/underscore slug conversion below are
// shared from api-client.js (orderStatusSlug()) — see customer-detail.js's
// matching comment.

async function renderOrders(vendor) {
  const section = document.getElementById("vd-orders-section");
  const list = document.getElementById("vd-orders-list");

  let orders = [];
  try {
    orders = await VetraAPI.request(`/admin/vendors/${vendor.id}/orders`, { method: "GET", role: "admin" });
  } catch (err) {
    section.hidden = false;
    list.innerHTML = `<p class="table-empty">Couldn't load orders: ${err.message}</p>`;
    return;
  }

  if (!orders.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  list.innerHTML = orders
    .map((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      const itemsLabel = items.length
        ? items.map((i) => `${i.name || "Item"}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ")
        : "Order";
      const slug = orderStatusSlug(o.status);
      const trackingLine = o.carrier || o.tracking_number
        ? `<p class="order-tracking-line">${[o.carrier, o.tracking_number].filter(Boolean).join(" · ")}</p>`
        : "";
      return `
      <div class="order-item">
        <div class="stat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"></path><path d="M8 7h8M8 11h8M8 15h5"></path></svg>
        </div>
        <div class="order-info">
          <p class="order-id">${itemsLabel}</p>
          <p class="order-meta">${o.buyer_name || "Unknown customer"} &middot; ${VetraAdmin.formatDate(o.created_at)}</p>
          ${trackingLine}
        </div>
        <div class="order-side">
          <p class="order-amount">${formatNaira(o.total)}</p>
          <span class="status-pill ${slug}">${ORDER_STATUS_LABEL[o.status] || o.status}</span>
        </div>
      </div>
    `;
    })
    .join("");
}

/* ---------------- Business Verification (KYC) ---------------- */
const KYC_LABEL = {
  verified: "verified",
  pending: "pending review",
  manual_review: "manual review",
  rejected: "rejected",
};

// The real vendor_kyc row only ever stores an uploaded document URL, never
// a filename — `label` is a generic doc-type name ("ID Document") rather
// than a real filename that was never captured.
function docChip(label, url) {
  if (!url) return `<span class="cell-sub">Not uploaded</span>`;
  return `
    <a class="kyc-doc-preview" href="${url}" target="_blank" rel="noopener noreferrer">
      <img src="${url}" alt="${label}" loading="lazy" />
      <span class="doc-chip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        ${label}
      </span>
    </a>
  `;
}

function renderKyc(vendor) {
  const status = vendor.kyc_status || "not_submitted";
  const badge = document.getElementById("vd-kyc-badge");
  badge.textContent = KYC_LABEL[status] || "not submitted";
  badge.className = `badge ${status === "verified" ? "active" : status === "rejected" ? "suspended" : "pending"}`;

  const body = document.getElementById("vd-kyc-body");

  if (!vendor.kyc_status) {
    body.innerHTML = `<p class="table-empty">This vendor hasn't submitted verification documents yet — nothing to review.</p>`;
    return;
  }

  body.innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Registered vendor name</label>
        <p class="cell-title">${escapeAuditText([vendor.first_name, vendor.middle_name, vendor.last_name].filter(Boolean).join(" ") || vendor.name || "—")}</p>
      </div>
      <div class="form-group">
        <label class="form-label">Submitted ID type</label>
        <p class="cell-title">${vendor.kyc_identity_type === "drivers_license" ? "Driver's licence" : vendor.kyc_identity_type === "nin" ? "NIN / VNIN" : "—"}</p>
      </div>
      <div class="form-group">
        <label class="form-label">Submitted ID number</label>
        <p class="cell-title kyc-sensitive-value">${escapeAuditText(vendor.kyc_identity_number || "—")}</p>
      </div>
      <div class="form-group">
        <label class="form-label">CAC registration number</label>
        <p class="cell-title kyc-sensitive-value">${escapeAuditText(vendor.kyc_cac_number || "—")}</p>
      </div>
      <div class="form-group">
        <label class="form-label">CheckID identity</label>
        <p class="cell-title">${vendor.kyc_identity_type === "drivers_license" ? "Driver's licence" : vendor.kyc_identity_type === "nin" ? "NIN / VNIN" : "—"}</p>
        <p class="cell-sub">${escapeAuditText(vendor.kyc_identity_provider_status || "Not checked")}${vendor.kyc_identity_provider_message ? ` — ${escapeAuditText(vendor.kyc_identity_provider_message)}` : ""}</p>
      </div>
      <div class="form-group">
        <label class="form-label">CheckID CAC</label>
        <p class="cell-title">${vendor.kyc_cac_provider_status || "Not checked"}</p>
        <p class="cell-sub">${escapeAuditText(vendor.kyc_cac_provider_message || "")}</p>
      </div>
      <div class="form-group">
        <label class="form-label">Submitted</label>
        <p class="cell-title">${vendor.kyc_submitted_at ? VetraAdmin.formatDateTime(vendor.kyc_submitted_at) : "—"}</p>
      </div>
      <div class="form-group">
        <label class="form-label">Valid ID</label>
        ${docChip("ID Document", vendor.kyc_id_document_url)}
      </div>
      <div class="form-group">
        <label class="form-label">CAC Certificate</label>
        ${docChip("CAC Certificate", vendor.kyc_cac_document_url)}
      </div>
    </div>
    ${
      ["pending", "manual_review"].includes(status) && canModerate()
        ? `<div class="table-actions" style="margin-top: 14px;">
             <button class="btn-approve" data-kyc-action="verify">Verify Documents</button>
             <button class="btn-reject" data-kyc-action="reject">Reject</button>
           </div>`
        : vendor.kyc_reviewed_at
        ? `<p class="cell-sub" style="margin-top: 10px;">
             Reviewed ${VetraAdmin.formatDateTime(vendor.kyc_reviewed_at)}${
             status === "rejected" && vendor.kyc_rejection_reason ? ` — ${vendor.kyc_rejection_reason}` : ""
           }
           </p>`
        : ""
    }
  `;

  body.querySelector('[data-kyc-action="verify"]')?.addEventListener("click", () => {
    AdminUI.confirm({
      title: "Verify business documents",
      bodyHtml: `Mark <span class="confirm-modal-target">${vendor.store_name}</span>'s ID and CAC documents as verified?`,
      confirmLabel: "Verify",
      onConfirm: () => setKycStatus(vendor, "verified"),
    });
  });

  body.querySelector('[data-kyc-action="reject"]')?.addEventListener("click", () => {
    AdminUI.confirm({
      title: "Reject business documents",
      bodyHtml: `Reject <span class="confirm-modal-target">${vendor.store_name}</span>'s submitted documents? They'll need to resubmit before their store can be approved.`,
      confirmLabel: "Reject",
      danger: true,
      // Required, not just offered — this reason is what the vendor
      // actually reads in their rejection email (see admin.routes.js's
      // PATCH /:id/kyc), so a rejection with nothing explaining it
      // isn't useful enough to let through.
      requireReason: true,
      onConfirm: (reason) => setKycStatus(vendor, "rejected", reason),
    });
  });
}

async function setKycStatus(vendor, status, reason) {
  try {
    await VetraAPI.request(`/admin/vendors/${vendor.id}/kyc`, {
      method: "PATCH", role: "admin", body: { status, reason },
    });
    await loadAndRender(vendor.id);
  } catch (err) {
    AdminUI.info({ title: "Couldn't update KYC status", bodyHtml: err.message });
  }
}

function renderStats(vendor) {
  const grid = document.getElementById("vd-stats");
  grid.innerHTML = `
    <div class="stat-card">
      <p class="stat-label">Products</p>
      <p class="stat-value">${vendor.products_count}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Orders</p>
      <p class="stat-value">${vendor.orders_count}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Revenue</p>
      <p class="stat-value">${formatNaira(vendor.revenue)}</p>
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
  const contactBtns = canModerate()
    ? `<button class="btn-reset" data-action="change-email" style="padding: 10px 16px; font-size: 13px;">Change Email</button>
       <button class="btn-reset" data-action="change-phone" style="padding: 10px 16px; font-size: 13px;">Change Phone</button>`
    : "";

  if (!canModerate()) {
    wrap.innerHTML = resetBtn;
  } else if (vendor.status === "pending") {
    wrap.innerHTML = `
      ${resetBtn}${contactBtns}
      <button class="btn-approve" data-action="approve" style="padding: 10px 16px; font-size: 13px;">Approve</button>
      <button class="btn-reject" data-action="reject" style="padding: 10px 16px; font-size: 13px;">Reject</button>
    `;
  } else if (vendor.status === "suspended") {
    wrap.innerHTML = `${resetBtn}${contactBtns}<button class="btn-activate" data-action="activate" style="padding: 10px 16px; font-size: 13px;">Reactivate Store</button>`;
  } else {
    wrap.innerHTML = `${resetBtn}${contactBtns}<button class="btn-suspend" data-action="suspend" style="padding: 10px 16px; font-size: 13px;">Suspend Store</button>`;
  }

  wrap.querySelector('[data-action="change-email"]')?.addEventListener("click", () => {
    VetraContactChange.openEmailChangeModal({
      endpointBase: "/admin/vendors",
      id: vendor.id,
      name: vendor.name,
      currentEmail: vendor.email,
      onDone: async () => {
        AdminUI.info({ title: "Email updated", bodyHtml: `${vendor.name}'s email has been changed.` });
        await loadAndRender(vendor.id);
      },
    });
  });

  wrap.querySelector('[data-action="change-phone"]')?.addEventListener("click", () => {
    VetraContactChange.openPhoneChangeModal({
      endpointBase: "/admin/vendors",
      id: vendor.id,
      name: vendor.name,
      currentPhone: vendor.phone,
      onDone: async () => {
        AdminUI.info({ title: "Phone number updated", bodyHtml: `${vendor.name}'s phone number has been changed.` });
        await loadAndRender(vendor.id);
      },
    });
  });

  wrap.querySelector('[data-action="reset-password"]').addEventListener("click", () => {
    AdminUI.confirm({
      title: "Reset password",
      bodyHtml: `Request a password reset for <span class="confirm-modal-target">${vendor.name}</span> (${vendor.store_name})? They'll need to use the emailed link to set a new password.`,
      confirmLabel: "Reset password",
      onConfirm: async () => {
        try {
          await VetraAPI.request(`/admin/vendors/${vendor.id}/reset-password`, { method: "POST", role: "admin" });
          AdminUI.info({
            title: "Reset requested",
            bodyHtml: `<p style="margin:0; font-size:13px; color:var(--muted);">
              A reset link has been emailed to ${vendor.name}.
            </p>`,
          });
          await renderActivity(vendor);
        } catch (err) {
          AdminUI.info({ title: "Couldn't request reset", bodyHtml: err.message });
        }
      },
    });
  });

  wrap.querySelectorAll('button[data-action]:not([data-action="reset-password"]):not([data-action="change-email"]):not([data-action="change-phone"])').forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;

      async function setStatus(status, reason) {
        try {
          await VetraAPI.request(`/admin/vendors/${vendor.id}/status`, {
            method: "PATCH", role: "admin", body: { status, reason },
          });
          await loadAndRender(vendor.id);
        } catch (err) {
          AdminUI.info({ title: "Couldn't update vendor", bodyHtml: err.message });
        }
      }

      if (action === "approve") {
        AdminUI.confirm({
          title: "Approve vendor",
          bodyHtml: `Approve <span class="confirm-modal-target">${vendor.store_name}</span>? Their store and listings will go live immediately.`,
          confirmLabel: "Approve",
          onConfirm: () => setStatus("active"),
        });
      } else if (action === "reject") {
        AdminUI.confirm({
          title: "Reject vendor application",
          bodyHtml: `Reject <span class="confirm-modal-target">${vendor.store_name}</span>'s application? They can re-apply later.`,
          confirmLabel: "Reject",
          danger: true,
          showReason: true,
          onConfirm: (reason) => setStatus("rejected", reason),
        });
      } else if (action === "suspend") {
        AdminUI.confirm({
          title: "Suspend vendor",
          bodyHtml: `Suspend <span class="confirm-modal-target">${vendor.store_name}</span>? Their store and listings will be hidden from buyers until reinstated.`,
          confirmLabel: "Suspend store",
          danger: true,
          showReason: true,
          onConfirm: (reason) => setStatus("suspended", reason),
        });
      } else if (action === "activate") {
        AdminUI.confirm({
          title: "Reactivate vendor",
          bodyHtml: `Reactivate <span class="confirm-modal-target">${vendor.store_name}</span>? Their store and listings will go live again immediately.`,
          confirmLabel: "Reactivate",
          onConfirm: () => setStatus("active"),
        });
      }
    });
  });
}

async function renderReports(vendor) {
  const section = document.getElementById("vd-reports-section");
  const list = document.getElementById("vd-reports-list");

  let reports = [];
  try {
    reports = await VetraAPI.request(`/reports?type=vendor&targetId=${vendor.id}`, { method: "GET", role: "admin" });
  } catch (err) {
    section.hidden = true;
    return;
  }

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
          <h4>Reported by ${r.reporter || "a buyer"}</h4>
          <p>Filed ${VetraAdmin.formatDate(r.created_at)}${r.attended_by_name ? ` · Attended by <span class="activity-actor">${r.attended_by_name}</span>` : ""}</p>
        </div>
        <span class="badge ${r.status}">${r.status}</span>
      </div>
      <p class="report-reason">${r.reason}</p>
    </div>
  `
    )
    .join("");
}

async function renderActivity(vendor) {
  const container = document.getElementById("vd-activity-feed");
  try {
    const rows = await VetraAPI.request(`/admin/activity?targetType=vendor&targetId=${vendor.id}`, {
      method: "GET", role: "admin",
    });
    const entries = rows.map((r) => ({ type: r.type, message: r.message, actorName: r.actor_name || null, time: r.created_at }));
    AdminUI.renderActivityFeed(container, entries);
  } catch (err) {
    container.innerHTML = `<p class="table-empty">Couldn't load activity: ${err.message}</p>`;
  }
}
