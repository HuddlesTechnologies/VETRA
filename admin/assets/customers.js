/* =========================================================
   VETRA — ADMIN CUSTOMERS (admin/customers.html)
   Renders the customer table from VetraAdmin.getCustomers(),
   with live search, a status filter (also readable from the
   URL, e.g. customers.html?filter=suspended so dashboard.html's
   "View Suspended Accounts" quick action lands pre-filtered),
   and the suspend/reactivate flow that goes through the shared
   confirm modal in ui.js. "View" links to customer-detail.html,
   which has the full profile, activity history, and any reports
   filed against this account.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("customer-search");
  const statusFilter = document.getElementById("customer-status-filter");

  const params = new URLSearchParams(window.location.search);
  const initialFilter = params.get("filter");
  if (initialFilter && ["active", "suspended"].includes(initialFilter)) {
    statusFilter.value = initialFilter;
  }

  function render() {
    const query = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;
    let rows = VetraAdmin.getCustomers();

    if (status !== "all") {
      rows = rows.filter((c) => c.status === status);
    }
    if (query) {
      rows = rows.filter(
        (c) => c.name.toLowerCase().includes(query) || c.email.toLowerCase().includes(query)
      );
    }

    const tbody = document.querySelector("#customers-table tbody");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No customers match this search/filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map(
        (c) => `
      <tr data-customer-id="${c.id}">
        <td>
          <a class="cell-entity" href="customer-detail.html?id=${c.id}" style="text-decoration: none; color: inherit;">
            <span class="cell-avatar">${VetraAdmin.initials(c.name)}</span>
            <div>
              <p class="cell-title">${c.name}</p>
              <p class="cell-sub">${c.email}</p>
            </div>
          </a>
        </td>
        <td class="cell-muted">${VetraAdmin.formatDate(c.joined)}</td>
        <td class="cell-muted">${c.orders}</td>
        <td class="cell-muted">${VetraAdmin.formatNaira(c.spent)}</td>
        <td><span class="badge ${c.status}">${c.status}</span></td>
        <td>
          <div class="table-actions">
            <a class="btn-view" href="customer-detail.html?id=${c.id}" style="text-decoration: none;">View</a>
            <button class="btn-reset" data-action="reset-password" data-id="${c.id}">Reset Password</button>
            ${
              c.status === "suspended"
                ? `<button class="btn-activate" data-action="activate" data-id="${c.id}">Reactivate</button>`
                : `<button class="btn-suspend" data-action="suspend" data-id="${c.id}">Suspend</button>`
            }
          </div>
        </td>
      </tr>
    `
      )
      .join("");
  }

  searchInput.addEventListener("input", render);
  statusFilter.addEventListener("change", render);

  document.querySelector("#customers-table tbody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const customer = VetraAdmin.getCustomer(id);
    if (!customer) return;

    if (btn.dataset.action === "suspend") {
      AdminUI.confirm({
        title: "Suspend customer",
        bodyHtml: `Suspend <span class="confirm-modal-target">${customer.name}</span>? They will be signed out and unable to place orders until reinstated.`,
        confirmLabel: "Suspend account",
        danger: true,
        showReason: true,
        onConfirm: (reason) => {
          VetraAdmin.setCustomerStatus(id, "suspended", reason);
          render();
        },
      });
    } else if (btn.dataset.action === "activate") {
      AdminUI.confirm({
        title: "Reactivate customer",
        bodyHtml: `Reactivate <span class="confirm-modal-target">${customer.name}</span>? They will regain full access immediately.`,
        confirmLabel: "Reactivate",
        onConfirm: () => {
          VetraAdmin.setCustomerStatus(id, "active");
          render();
        },
      });
    } else if (btn.dataset.action === "reset-password") {
      AdminUI.confirm({
        title: "Reset password",
        bodyHtml: `Reset the password for <span class="confirm-modal-target">${customer.name}</span>? They'll be signed out everywhere and need to use a new temporary password to sign back in.`,
        confirmLabel: "Reset password",
        onConfirm: () => {
          const tempPassword = VetraAdmin.resetCustomerPassword(id);
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
        },
      });
    }
  });

  render();
});
