/* =========================================================
   VETRA: Customer detail (admin/customer-detail.html?id=<id>, real backend).
   Full profile view for one customer: contact/account info, lifetime
   order stats, real order history, any reports filed against them,
   and their real activity history, all from GET /api/admin/customers/:id
   (+ /orders) and the target-scoped /api/reports, /api/admin/activity.
   ========================================================= */

let currentCustomer = null;

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    document.getElementById("customer-not-found").hidden = false;
    document.getElementById("customer-detail-content").hidden = true;
    return;
  }

  await loadAndRender(id);
});

async function loadAndRender(id) {
  try {
    currentCustomer = await VetraAPI.request(`/admin/customers/${id}`, { method: "GET", role: "admin" });
  } catch (err) {
    document.getElementById("customer-not-found").hidden = false;
    document.getElementById("customer-detail-content").hidden = true;
    return;
  }
  render(currentCustomer);
}

function render(customer) {
  document.title = `VETRA · Admin · ${customer.name}`;
  document.getElementById("cd-name").textContent = customer.name;
  document.getElementById("cd-name-2").textContent = customer.name;
  document.getElementById("cd-email").textContent = customer.email;
  document.getElementById("cd-avatar").textContent = VetraAdmin.initials(customer.name);
  document.getElementById("cd-signup-method").textContent = `Signed up via ${customer.signup_method || "Email"}`;

  const statusBadge = document.getElementById("cd-status-badge");
  statusBadge.textContent = customer.status;
  statusBadge.className = `badge ${customer.status}`;

  document.getElementById("cd-phone").textContent = customer.phone || "—";
  document.getElementById("cd-address").textContent = customer.address || "—";
  document.getElementById("cd-joined").textContent = VetraAdmin.formatDate(customer.created_at);
  document.getElementById("cd-last-login").textContent = VetraAdmin.formatDateWithRelative(customer.last_login_at);

  renderStats(customer);
  renderActions(customer);
  AdminUI.renderIpHistory(customer.id, "cd-ip-history");
  renderOrders(customer);
  renderReports(customer);
  renderActivity(customer);
}

// ORDER_STATUS_LABEL and the hyphen/underscore slug conversion below are
// shared from api-client.js (orderStatusSlug()), also used by customer/
// vendor.assets/orders.js and this page's vendor-detail.js sibling.

function orderStatusIcon() {
  return `<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"></path><path d="M8 7h8M8 11h8M8 15h5"></path>`;
}

async function renderOrders(customer) {
  const section = document.getElementById("cd-orders-section");
  const list = document.getElementById("cd-orders-list");

  let orders = [];
  try {
    orders = await VetraAPI.request(`/admin/customers/${customer.id}/orders`, { method: "GET", role: "admin" });
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${orderStatusIcon()}</svg>
        </div>
        <div class="order-info">
          <p class="order-id">${itemsLabel}</p>
          <p class="order-meta">${o.vendor_name || "Unknown vendor"} &middot; ${VetraAdmin.formatDate(o.created_at)}</p>
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

function renderStats(customer) {
  const grid = document.getElementById("cd-stats");
  grid.innerHTML = `
    <div class="stat-card">
      <p class="stat-label">Orders Placed</p>
      <p class="stat-value">${customer.order_count}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Total Spent</p>
      <p class="stat-value">${formatNaira(customer.total_spent)}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Account Status</p>
      <p class="stat-value" style="font-size: 16px; text-transform: capitalize;">${customer.status}</p>
    </div>
  `;
}

function renderActions(customer) {
  const wrap = document.getElementById("cd-actions");
  const statusBtn = canModerate()
    ? customer.status === "suspended"
      ? `<button class="btn-activate" data-action="activate" style="padding: 10px 16px; font-size: 13px;">Reactivate Account</button>`
      : `<button class="btn-suspend" data-action="suspend" style="padding: 10px 16px; font-size: 13px;">Suspend Account</button>`
    : "";
  const contactBtns = canModerate()
    ? `<button class="btn-reset" data-action="change-email" style="padding: 10px 16px; font-size: 13px;">Change Email</button>
       <button class="btn-reset" data-action="change-phone" style="padding: 10px 16px; font-size: 13px;">Change Phone</button>`
    : "";
  wrap.innerHTML = `
    <button class="btn-reset" data-action="reset-password" style="padding: 10px 16px; font-size: 13px;">Reset Password</button>
    ${contactBtns}
    ${statusBtn}
  `;

  wrap.querySelector('[data-action="change-email"]')?.addEventListener("click", () => {
    VetraContactChange.openEmailChangeModal({
      endpointBase: "/admin/customers",
      id: customer.id,
      name: customer.name,
      currentEmail: customer.email,
      onDone: async () => {
        AdminUI.info({ title: "Email updated", bodyHtml: `${customer.name}'s email has been changed.` });
        await loadAndRender(customer.id);
      },
    });
  });

  wrap.querySelector('[data-action="change-phone"]')?.addEventListener("click", () => {
    VetraContactChange.openPhoneChangeModal({
      endpointBase: "/admin/customers",
      id: customer.id,
      name: customer.name,
      currentPhone: customer.phone,
      onDone: async () => {
        AdminUI.info({ title: "Phone number updated", bodyHtml: `${customer.name}'s phone number has been changed.` });
        await loadAndRender(customer.id);
      },
    });
  });

  wrap.querySelector('[data-action="reset-password"]').addEventListener("click", () => {
    AdminUI.confirm({
      title: "Reset password",
      bodyHtml: `Request a password reset for <span class="confirm-modal-target">${customer.name}</span>? They'll need to use the emailed link to set a new password.`,
      confirmLabel: "Reset password",
      onConfirm: async () => {
        try {
          await VetraAPI.request(`/admin/customers/${customer.id}/reset-password`, { method: "POST", role: "admin" });
          AdminUI.info({
            title: "Reset requested",
            bodyHtml: `<p style="margin:0; font-size:13px; color:var(--muted);">
              A reset link has been emailed to ${customer.name}.
            </p>`,
          });
          await renderActivity(customer);
        } catch (err) {
          AdminUI.info({ title: "Couldn't request reset", bodyHtml: err.message });
        }
      },
    });
  });

  wrap.querySelector('[data-action="suspend"], [data-action="activate"]')?.addEventListener("click", () => {
    async function setStatus(status, reason) {
      try {
        await VetraAPI.request(`/admin/customers/${customer.id}/status`, {
          method: "PATCH", role: "admin", body: { status, reason },
        });
        await loadAndRender(customer.id);
      } catch (err) {
        AdminUI.info({ title: "Couldn't update customer", bodyHtml: err.message });
      }
    }

    if (customer.status === "suspended") {
      AdminUI.confirm({
        title: "Reactivate customer",
        bodyHtml: `Reactivate <span class="confirm-modal-target">${customer.name}</span>? They will regain full access immediately.`,
        confirmLabel: "Reactivate",
        onConfirm: () => setStatus("active"),
      });
    } else {
      AdminUI.confirm({
        title: "Suspend customer",
        bodyHtml: `Suspend <span class="confirm-modal-target">${customer.name}</span>? They will be signed out and unable to place orders until reinstated.`,
        confirmLabel: "Suspend account",
        danger: true,
        showReason: true,
        onConfirm: (reason) => setStatus("suspended", reason),
      });
    }
  });
}

async function renderReports(customer) {
  const section = document.getElementById("cd-reports-section");
  const list = document.getElementById("cd-reports-list");

  let reports = [];
  try {
    reports = await VetraAPI.request(`/reports?type=customer&targetId=${customer.id}`, { method: "GET", role: "admin" });
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

async function renderActivity(customer) {
  const container = document.getElementById("cd-activity-feed");
  try {
    const rows = await VetraAPI.request(`/admin/activity?targetType=customer&targetId=${customer.id}`, {
      method: "GET", role: "admin",
    });
    const entries = rows.map((r) => ({ type: r.type, message: r.message, actorName: r.actor_name || null, time: r.created_at }));
    AdminUI.renderActivityFeed(container, entries);
  } catch (err) {
    container.innerHTML = `<p class="table-empty">Couldn't load activity: ${err.message}</p>`;
  }
}
