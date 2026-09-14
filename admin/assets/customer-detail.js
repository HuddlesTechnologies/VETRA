/* =========================================================
   VETRA — CUSTOMER DETAIL (admin/customer-detail.html?id=<id>)
   Full profile view for one customer: contact/account info,
   lifetime order stats, any reports filed against them
   (VetraAdmin.getReportsForTarget), and their full activity
   history (VetraAdmin.getActivityForTarget) — everything the
   list view's old quick-look modal didn't have room for.
   Suspend/Reactivate works the same way it does on
   customers.html, through the shared confirm modal.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const customer = id ? VetraAdmin.getCustomer(id) : null;

  if (!customer) {
    document.getElementById("customer-not-found").hidden = false;
    document.getElementById("customer-detail-content").hidden = true;
    return;
  }

  render(customer);
});

function render(customer) {
  document.title = `VETRA — Admin · ${customer.name}`;
  document.getElementById("cd-name").textContent = customer.name;
  document.getElementById("cd-name-2").textContent = customer.name;
  document.getElementById("cd-email").textContent = customer.email;
  document.getElementById("cd-avatar").textContent = VetraAdmin.initials(customer.name);
  document.getElementById("cd-signup-method").textContent = `Signed up via ${customer.signupMethod || "Email"}`;

  const statusBadge = document.getElementById("cd-status-badge");
  statusBadge.textContent = customer.status;
  statusBadge.className = `badge ${customer.status}`;

  document.getElementById("cd-phone").textContent = customer.phone || "—";
  document.getElementById("cd-address").textContent = customer.address || "—";
  document.getElementById("cd-joined").textContent = formatDate(customer.joined);
  document.getElementById("cd-last-login").textContent = customer.lastLogin
    ? `${formatDate(customer.lastLogin)} (${VetraAdmin.timeAgo(customer.lastLogin)})`
    : "—";

  renderStats(customer);
  renderActions(customer);
  renderReports(customer);
  renderActivity(customer);
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
}

function renderStats(customer) {
  const grid = document.getElementById("cd-stats");
  grid.innerHTML = `
    <div class="stat-card">
      <p class="stat-label">Orders Placed</p>
      <p class="stat-value">${customer.orders}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Total Spent</p>
      <p class="stat-value">${VetraAdmin.formatNaira(customer.spent)}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Account Status</p>
      <p class="stat-value" style="font-size: 16px; text-transform: capitalize;">${customer.status}</p>
    </div>
  `;
}

function renderActions(customer) {
  const wrap = document.getElementById("cd-actions");
  const statusBtn =
    customer.status === "suspended"
      ? `<button class="btn-activate" data-action="activate" style="padding: 10px 16px; font-size: 13px;">Reactivate Account</button>`
      : `<button class="btn-suspend" data-action="suspend" style="padding: 10px 16px; font-size: 13px;">Suspend Account</button>`;
  wrap.innerHTML = `
    <button class="btn-reset" data-action="reset-password" style="padding: 10px 16px; font-size: 13px;">Reset Password</button>
    ${statusBtn}
  `;

  wrap.querySelector('[data-action="reset-password"]').addEventListener("click", () => {
    AdminUI.confirm({
      title: "Reset password",
      bodyHtml: `Reset the password for <span class="confirm-modal-target">${customer.name}</span>? They'll be signed out everywhere and need to use a new temporary password to sign back in.`,
      confirmLabel: "Reset password",
      onConfirm: () => {
        const tempPassword = VetraAdmin.resetCustomerPassword(customer.id);
        AdminUI.info({
          title: "Password reset",
          bodyHtml: `
            <p style="margin: 0 0 10px; font-size: 13px; color: var(--muted);">Share this temporary password with ${customer.name} securely. They'll be required to set a new one at next sign-in.</p>
            <div class="reveal-panel">
              <p>Temporary password</p>
              <div class="reveal-value">${tempPassword}</div>
            </div>
          `,
        });
        renderActivity(customer);
      },
    });
  });

  wrap.querySelector('[data-action="suspend"], [data-action="activate"]').addEventListener("click", () => {
    if (customer.status === "suspended") {
      AdminUI.confirm({
        title: "Reactivate customer",
        bodyHtml: `Reactivate <span class="confirm-modal-target">${customer.name}</span>? They will regain full access immediately.`,
        confirmLabel: "Reactivate",
        onConfirm: () => {
          VetraAdmin.setCustomerStatus(customer.id, "active");
          render(VetraAdmin.getCustomer(customer.id));
        },
      });
    } else {
      AdminUI.confirm({
        title: "Suspend customer",
        bodyHtml: `Suspend <span class="confirm-modal-target">${customer.name}</span>? They will be signed out and unable to place orders until reinstated.`,
        confirmLabel: "Suspend account",
        danger: true,
        showReason: true,
        onConfirm: (reason) => {
          VetraAdmin.setCustomerStatus(customer.id, "suspended", reason);
          render(VetraAdmin.getCustomer(customer.id));
        },
      });
    }
  });
}

function renderReports(customer) {
  const section = document.getElementById("cd-reports-section");
  const list = document.getElementById("cd-reports-list");
  const reports = VetraAdmin.getReportsForTarget("customer", customer.id);

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

function renderActivity(customer) {
  const entries = VetraAdmin.getActivityForTarget("customer", customer.id);
  AdminUI.renderActivityFeed(document.getElementById("cd-activity-feed"), entries);
}
