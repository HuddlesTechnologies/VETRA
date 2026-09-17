/* =========================================================
   VETRA — ADMIN CUSTOMERS (admin/customers.html, real backend)
   Renders the customer table from GET /api/admin/customers, with
   live search (re-queries the server via ?q=), a status filter
   (client-side — the full set is small enough not to need a
   server round trip per filter change), and the suspend/reactivate
   flow via PATCH /api/admin/customers/:id/status.
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;

  const searchInput = document.getElementById("customer-search");
  const statusFilter = document.getElementById("customer-status-filter");
  const tbody = document.querySelector("#customers-table tbody");

  const params = new URLSearchParams(window.location.search);
  const initialFilter = params.get("filter");
  if (initialFilter && ["active", "suspended"].includes(initialFilter)) {
    statusFilter.value = initialFilter;
  }

  let customers = [];
  let searchDebounce;

  function customerById(id) {
    return customers.find((c) => c.id === id) || null;
  }

  function renderRows() {
    const status = statusFilter.value;
    let rows = customers;
    if (status !== "all") {
      rows = rows.filter((c) => c.status === status);
    }

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
        <td class="cell-muted">${VetraAdmin.formatDate(c.created_at)}</td>
        <td class="cell-muted">${c.order_count}</td>
        <td class="cell-muted">${formatNaira(c.total_spent)}</td>
        <td><span class="badge ${c.status}">${c.status}</span></td>
        <td>
          <div class="table-actions">
            <a class="btn-view" href="customer-detail.html?id=${c.id}" style="text-decoration: none;">View</a>
            <button class="btn-reset" data-action="reset-password" data-id="${c.id}">Reset Password</button>
            ${
              canModerate()
                ? c.status === "suspended"
                  ? `<button class="btn-activate" data-action="activate" data-id="${c.id}">Reactivate</button>`
                  : `<button class="btn-suspend" data-action="suspend" data-id="${c.id}">Suspend</button>`
                : ""
            }
          </div>
        </td>
      </tr>
    `
      )
      .join("");
  }

  async function load() {
    const q = searchInput.value.trim();
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Loading…</td></tr>`;
    try {
      customers = await VetraAPI.request(`/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`, {
        method: "GET",
        role: "admin",
      });
      renderRows();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Couldn't load customers: ${err.message}</td></tr>`;
    }
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(load, 300);
  });
  statusFilter.addEventListener("change", renderRows);

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const customer = customerById(id);
    if (!customer) return;

    if (btn.dataset.action === "suspend") {
      AdminUI.confirm({
        title: "Suspend customer",
        bodyHtml: `Suspend <span class="confirm-modal-target">${customer.name}</span>? They will be signed out and unable to place orders until reinstated.`,
        confirmLabel: "Suspend account",
        danger: true,
        showReason: true,
        onConfirm: async (reason) => {
          try {
            await VetraAPI.request(`/admin/customers/${id}/status`, {
              method: "PATCH", role: "admin", body: { status: "suspended", reason },
            });
            await load();
          } catch (err) {
            AdminUI.info({ title: "Couldn't suspend customer", bodyHtml: err.message });
          }
        },
      });
    } else if (btn.dataset.action === "activate") {
      AdminUI.confirm({
        title: "Reactivate customer",
        bodyHtml: `Reactivate <span class="confirm-modal-target">${customer.name}</span>? They will regain full access immediately.`,
        confirmLabel: "Reactivate",
        onConfirm: async () => {
          try {
            await VetraAPI.request(`/admin/customers/${id}/status`, {
              method: "PATCH", role: "admin", body: { status: "active" },
            });
            await load();
          } catch (err) {
            AdminUI.info({ title: "Couldn't reactivate customer", bodyHtml: err.message });
          }
        },
      });
    } else if (btn.dataset.action === "reset-password") {
      AdminUI.confirm({
        title: "Reset password",
        bodyHtml: `Request a password reset for <span class="confirm-modal-target">${customer.name}</span>? They'll need to use the emailed link to set a new password.`,
        confirmLabel: "Reset password",
        onConfirm: async () => {
          try {
            await VetraAPI.request(`/admin/customers/${id}/reset-password`, { method: "POST", role: "admin" });
            AdminUI.info({
              title: "Reset requested",
              bodyHtml: `<p style="margin:0; font-size:13px; color:var(--muted);">
                A reset link has been emailed to ${customer.name}.
              </p>`,
            });
          } catch (err) {
            AdminUI.info({ title: "Couldn't request reset", bodyHtml: err.message });
          }
        },
      });
    }
  });

  await load();
});
