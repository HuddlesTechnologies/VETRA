/* =========================================================
   VETRA — VENDOR ORDERS PAGE INTERACTIONS
   Page-specific script for vendor/orders.html only.

   The order list is static markup in orders.html itself (each
   row carries a data-status attribute). This file only wires up
   the status filter tabs to show/hide matching rows.
   ========================================================= */

function wireOrderFilterTabs() {
  const tabs = document.getElementById("order-filter-tabs");
  const list = document.getElementById("order-list");
  if (!tabs || !list) return;

  const rows = Array.from(list.querySelectorAll(".order-item"));

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tab");
    if (!btn) return;

    tabs.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    const filter = btn.dataset.filter;
    rows.forEach((row) => {
      const show = filter === "all" || row.dataset.status === filter;
      row.style.display = show ? "" : "none";
    });
  });
}

document.addEventListener("DOMContentLoaded", wireOrderFilterTabs);
