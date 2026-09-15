/* =========================================================
   VETRA — VENDOR PRODUCT GRID ACTIONS
   Shared by vendor/dashboard.html and vendor/products.html — both
   pages render a ".vendor-products-grid" of product cards with
   per-card Edit/Remove buttons and an "Add Product" shortcut that
   opens the shared modal (assets/add-product.js). This used to be
   copy-pasted verbatim into dashboard.js and products.js; it now
   lives in one place so the two pages can't drift out of sync.
   Replace the TODOs with real navigation / API calls once the
   backend is ready.
   ========================================================= */

function wireVendorProductActions() {
  document.querySelectorAll(".vendor-products-grid").forEach((grid) => {
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const card = btn.closest(".vendor-product-card");
      const name = card?.querySelector(".product-name")?.textContent.trim() || "this product";

      if (btn.dataset.action === "edit") {
        // TODO: replace with real navigation, e.g.
        // window.location.href = `edit-product.html?id=${productId}`;
        VendorUI.info({
          title: "Not wired up yet",
          bodyHtml: `Edit "${name}" — hook this up to your edit-product page.`,
        });
      } else if (btn.dataset.action === "remove") {
        // TODO: replace with a real delete API call.
        VendorUI.confirm({
          title: "Remove product",
          bodyHtml: `Remove <span class="confirm-modal-target">${name}</span> from your store?`,
          confirmLabel: "Remove",
          danger: true,
          onConfirm: () => {
            if (card) card.remove();
          },
        });
      }
    });
  });
}

function wireAddProductButton() {
  const btn = document.getElementById("add-product-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (window.VetraAddProduct) window.VetraAddProduct.open();
  });
}

/* ---------- CATEGORY FILTER TABS (vendor/products.html only) ----------
   Lets a vendor filter their own listed products by category instead of
   scrolling one long grid. Each card carries a data-category attribute
   (set in the static markup, or by add-product.js's buildProductCard()
   for a freshly-added one); a tab shows/hides cards by comparing against
   it. Exposed as window.VetraProductFilter.reapply() so add-product.js
   can re-run the active filter after prepending a new card. */
function wireProductFilterTabs() {
  const tabs = document.getElementById("product-filter-tabs");
  const grid = document.querySelector(".vendor-products-grid");
  if (!tabs || !grid) return;

  function apply() {
    const active = tabs.querySelector(".filter-tab.active");
    const filter = active ? active.dataset.filter : "all";
    grid.querySelectorAll(".vendor-product-card").forEach((card) => {
      const matches = filter === "all" || card.dataset.category === filter;
      card.hidden = !matches;
    });
  }

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tab");
    if (!btn) return;
    tabs.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    apply();
  });

  apply();
  window.VetraProductFilter = { reapply: apply };
}

document.addEventListener("DOMContentLoaded", () => {
  wireVendorProductActions();
  wireAddProductButton();
  wireProductFilterTabs();
});
