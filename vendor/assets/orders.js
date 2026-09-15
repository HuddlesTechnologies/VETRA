/* =========================================================
   VETRA — VENDOR ORDERS PAGE INTERACTIONS
   Page-specific script for vendor/orders.html only.

   The order list is static markup in orders.html itself (each
   row carries a data-status attribute). This file wires up the
   status filter tabs to show/hide matching rows, and caps how
   many of the *currently matching* rows are visible at once
   (MAX_VISIBLE) until "Show more" is clicked — requested
   directly so a vendor with a long order history doesn't get a
   huge list by default. Switching filters resets back to capped.
   ========================================================= */

const ORDERS_MAX_VISIBLE = 5;

function wireOrderFilterTabs() {
  const tabs = document.getElementById("order-filter-tabs");
  const list = document.getElementById("order-list");
  const showMoreBtn = document.getElementById("orders-show-more-btn");
  if (!tabs || !list) return;

  const rows = Array.from(list.querySelectorAll(".order-item"));
  let currentFilter = "all";
  let expanded = false;

  function applyVisibility() {
    const matching = rows.filter(
      (row) => currentFilter === "all" || row.dataset.status === currentFilter
    );
    const visibleCount = expanded ? matching.length : Math.min(ORDERS_MAX_VISIBLE, matching.length);
    const visibleRows = matching.slice(0, visibleCount);

    rows.forEach((row) => {
      row.style.display = visibleRows.includes(row) ? "" : "none";
    });

    if (showMoreBtn) {
      const remaining = matching.length - visibleCount;
      showMoreBtn.hidden = remaining <= 0;
      if (remaining > 0) {
        showMoreBtn.textContent = `Show ${remaining} more order${remaining === 1 ? "" : "s"}`;
      }
    }
  }

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tab");
    if (!btn) return;

    tabs.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    currentFilter = btn.dataset.filter;
    expanded = false;
    applyVisibility();
  });

  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", () => {
      expanded = true;
      applyVisibility();
    });
  }

  applyVisibility();
}

document.addEventListener("DOMContentLoaded", wireOrderFilterTabs);
