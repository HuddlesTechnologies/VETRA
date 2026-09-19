/* =========================================================
   VETRA — ADMIN VENDORS (admin/vendors.html, real backend)
   Same shape as customers.js: renders GET /api/admin/vendors into
   a table with search (client-side — the status filter tabs
   already narrow the server query) and status filter tabs.
   Pending vendors get Approve/Reject instead of Suspend.
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;

  const searchInput = document.getElementById("vendor-search");
  const kycFilter = document.getElementById("vendor-kyc-filter");
  const tabs = document.querySelectorAll("#vendor-filter-tabs .filter-tab");
  const tbody = document.querySelector("#vendors-table tbody");

  const params = new URLSearchParams(window.location.search);
  const initialFilter = params.get("filter");
  let activeFilter = "all";
  if (initialFilter && ["active", "pending", "suspended"].includes(initialFilter)) {
    activeFilter = initialFilter;
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.filter === initialFilter));
  }

  let vendors = [];

  function vendorById(id) {
    return vendors.find((v) => v.id === id) || null;
  }

  function renderRows() {
    const query = searchInput.value.trim().toLowerCase();
    const kycSelection = kycFilter.value;
    // Rejected vendors never show here, at any filter — same as the
    // original mock's behavior.
    let rows = vendors.filter((v) => v.status !== "rejected");

    if (activeFilter !== "all") {
      rows = rows.filter((v) => v.status === activeFilter);
    }
    if (kycSelection === "submitted") {
      rows = rows.filter((v) => Boolean(v.kyc_documents_submitted));
    } else if (kycSelection === "not-submitted") {
      rows = rows.filter((v) => !Boolean(v.kyc_documents_submitted));
    }
    if (query) {
      rows = rows.filter(
        (v) => (v.store_name || "").toLowerCase().includes(query) || (v.name || "").toLowerCase().includes(query)
      );
    }

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No vendors match this search/filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map(
        (v) => `
      <tr data-vendor-id="${v.id}">
        <td>
          <a class="cell-entity" href="vendor-detail.html?id=${v.id}" style="text-decoration: none; color: inherit;">
            <span class="cell-avatar">${VetraAdmin.initials(v.store_name)}</span>
            <div>
              <p class="cell-title">${v.store_name}</p>
              <p class="cell-sub">${v.name}</p>
            </div>
          </a>
        </td>
        <td class="cell-muted">${v.store_category || "—"}</td>
        <td class="cell-muted">${v.products_count}</td>
        <td class="cell-muted">${v.orders_count}</td>
        <td class="cell-muted">${formatNaira(v.revenue)}</td>
        <td class="cell-muted">${v.last_login_ip || "—"}</td>
        <td><span class="badge ${v.status}">${v.status}</span></td>
        <td>
          <div class="table-actions">
            <a class="btn-view" href="vendor-detail.html?id=${v.id}" style="text-decoration: none;">View</a>
            <button class="btn-reset" data-action="reset-password" data-id="${v.id}">Reset Password</button>
            ${isSuperAdmin() ? `<button class="btn-suspend" data-action="delete-account" data-id="${v.id}">Delete Account</button>` : ""}
            ${
              !canModerate()
                ? ""
                : v.status === "pending"
                ? `<button class="btn-approve" data-action="approve" data-id="${v.id}">Approve</button>
                   <button class="btn-reject" data-action="reject" data-id="${v.id}">Reject</button>`
                : v.status === "suspended"
                ? `<button class="btn-activate" data-action="activate" data-id="${v.id}">Reactivate</button>`
                : `<button class="btn-suspend" data-action="suspend" data-id="${v.id}">Suspend</button>`
            }
          </div>
        </td>
      </tr>
    `
      )
      .join("");
  }

  async function load() {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Loading…</td></tr>`;
    try {
      vendors = await VetraAPI.request("/admin/vendors", { method: "GET", role: "admin" });
      renderRows();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Couldn't load vendors: ${err.message}</td></tr>`;
    }
  }

  searchInput.addEventListener("input", renderRows);
  kycFilter.addEventListener("change", renderRows);
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeFilter = tab.dataset.filter;
      renderRows();
    });
  });

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const vendor = vendorById(id);
    if (!vendor) return;
    const action = btn.dataset.action;

    async function setStatus(status, reason) {
      try {
        await VetraAPI.request(`/admin/vendors/${id}/status`, {
          method: "PATCH", role: "admin", body: { status, reason },
        });
        await load();
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
    } else if (action === "reset-password") {
      AdminUI.confirm({
        title: "Reset password",
        bodyHtml: `Request a password reset for <span class="confirm-modal-target">${vendor.name}</span> (${vendor.store_name})? They'll need to use the emailed link to set a new password.`,
        confirmLabel: "Reset password",
        onConfirm: async () => {
          try {
            await VetraAPI.request(`/admin/vendors/${id}/reset-password`, { method: "POST", role: "admin" });
            AdminUI.info({
              title: "Reset requested",
              bodyHtml: `<p style="margin:0; font-size:13px; color:var(--muted);">
                A reset link has been emailed to ${vendor.name}.
              </p>`,
            });
          } catch (err) {
            AdminUI.info({ title: "Couldn't request reset", bodyHtml: err.message });
          }
        },
      });
    } else if (action === "delete-account") {
      AdminUI.confirm({
        title: "Delete vendor account",
        bodyHtml: `Permanently delete <span class="confirm-modal-target">${vendor.store_name || vendor.name}</span>'s account? Their personal details will be anonymized, listings will be removed, and this cannot be undone. Order history will be preserved.`,
        confirmLabel: "Delete account",
        danger: true,
        onConfirm: async () => {
          try {
            await VetraAPI.request(`/admin/vendors/${id}`, { method: "DELETE", role: "admin" });
            await load();
          } catch (err) {
            AdminUI.info({ title: "Couldn't delete vendor", bodyHtml: err.message });
          }
        },
      });
    }
  });

  await load();
});
