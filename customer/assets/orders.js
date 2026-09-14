/* =========================================================
   VETRA — CUSTOMER ORDERS & TRACKING PAGE
   Page-specific script for customer/orders.html only.

   Two independent behaviours on the same list:
   1. Status filter tabs (identical pattern to vendor/assets/
      orders.js) show/hide order cards by data-status.
   2. Each order card's summary row is a button that expands/
      collapses its own tracking timeline — an accordion, not a
      single "open one at a time" pattern, since a shopper may
      want to compare two orders' progress side by side.
   ========================================================= */

function wireOrderFilterTabs() {
  const tabs = document.getElementById("order-filter-tabs");
  const list = document.getElementById("order-list");
  if (!tabs || !list) return;

  const cards = Array.from(list.querySelectorAll(".order-card"));

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tab");
    if (!btn) return;

    tabs.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    const filter = btn.dataset.filter;
    cards.forEach((card) => {
      const show = filter === "all" || card.dataset.status === filter;
      card.style.display = show ? "" : "none";
    });
  });
}

function wireOrderExpand() {
  const list = document.getElementById("order-list");
  if (!list) return;

  list.addEventListener("click", (e) => {
    const summary = e.target.closest(".order-card-summary");
    if (!summary) return;
    const card = summary.closest(".order-card");
    if (!card) return;

    const isOpen = card.classList.toggle("open");
    summary.setAttribute("aria-expanded", String(isOpen));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireOrderFilterTabs();
  wireOrderExpand();
});
