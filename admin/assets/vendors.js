/* =========================================================
   VETRA — ADMIN VENDORS (admin/vendors.html)
   Same shape as customers.js: renders VetraAdmin.getVendors()
   into a table with search + status filter tabs (also readable
   from the URL, e.g. vendors.html?filter=pending). Pending
   vendors get Approve/Reject actions instead of Suspend, since
   they haven't gone live yet. "View" links to vendor-detail.html,
   which has the full store profile, activity history, and any
   reports filed against this vendor.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("vendor-search");
  const tabs = document.querySelectorAll("#vendor-filter-tabs .filter-tab");

  const params = new URLSearchParams(window.location.search);
  const initialFilter = params.get("filter");
  let activeFilter = "all";
  if (initialFilter && ["active", "pending", "suspended"].includes(initialFilter)) {
    activeFilter = initialFilter;
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.filter === initialFilter));
  }

  function render() {
    const query = searchInput.value.trim().toLowerCase();
    let rows = VetraAdmin.getVendors().filter((v) => v.status !== "rejected");

    if (activeFilter !== "all") {
      rows = rows.filter((v) => v.status === activeFilter);
    }
    if (query) {
      rows = rows.filter(
        (v) => v.store.toLowerCase().includes(query) || v.owner.toLowerCase().includes(query)
      );
    }

    const tbody = document.querySelector("#vendors-table tbody");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No vendors match this search/filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map(
        (v) => `
      <tr data-vendor-id="${v.id}">
        <td>
          <a class="cell-entity" href="vendor-detail.html?id=${v.id}" style="text-decoration: none; color: inherit;">
            <span class="cell-avatar">${VetraAdmin.initials(v.store)}</span>
            <div>
              <p class="cell-title">${v.store}</p>
              <p class="cell-sub">${v.owner}</p>
            </div>
          </a>
        </td>
        <td class="cell-muted">${v.category}</td>
        <td class="cell-muted">${v.products}</td>
        <td class="cell-muted">${v.orders}</td>
        <td class="cell-muted">${VetraAdmin.formatNaira(v.revenue)}</td>
        <td><span class="badge ${v.status}">${v.status}</span></td>
        <td>
          <div class="table-actions">
            <a class="btn-view" href="vendor-detail.html?id=${v.id}" style="text-decoration: none;">View</a>
            <button class="btn-reset" data-action="reset-password" data-id="${v.id}">Reset Password</button>
            ${
              v.status === "pending"
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

  searchInput.addEventListener("input", render);
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeFilter = tab.dataset.filter;
      render();
    });
  });

  document.querySelector("#vendors-table tbody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const vendor = VetraAdmin.getVendor(id);
    if (!vendor) return;
    const action = btn.dataset.action;

    if (action === "approve") {
      AdminUI.confirm({
        title: "Approve vendor",
        bodyHtml: `Approve <span class="confirm-modal-target">${vendor.store}</span>? Their store and listings will go live immediately.`,
        confirmLabel: "Approve",
        onConfirm: () => {
          VetraAdmin.setVendorStatus(id, "active");
          render();
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
          VetraAdmin.setVendorStatus(id, "rejected", reason);
          render();
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
          VetraAdmin.setVendorStatus(id, "suspended", reason);
          render();
        },
      });
    } else if (action === "activate") {
      AdminUI.confirm({
        title: "Reactivate vendor",
        bodyHtml: `Reactivate <span class="confirm-modal-target">${vendor.store}</span>? Their store and listings will go live again immediately.`,
        confirmLabel: "Reactivate",
        onConfirm: () => {
          VetraAdmin.setVendorStatus(id, "active");
          render();
        },
      });
    } else if (action === "reset-password") {
      AdminUI.confirm({
        title: "Reset password",
        bodyHtml: `Reset the password for <span class="confirm-modal-target">${vendor.owner}</span> (${vendor.store})? They'll be signed out everywhere and need to use a new temporary password to sign back in.`,
        confirmLabel: "Reset password",
        onConfirm: () => {
          const tempPassword = VetraAdmin.resetVendorPassword(id);
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
        },
      });
    }
  });

  render();
});
