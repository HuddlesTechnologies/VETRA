/* =========================================================
   VETRA — VENDOR PRODUCT GRID ACTIONS
   Shared by vendor/dashboard.html and vendor/products.html — both
   pages render a ".vendor-products-grid" (assets/products-data.js)
   of real product cards with per-card Edit/Remove buttons and an
   "Add Product" shortcut that opens the shared modal
   (assets/add-product.js).
   ========================================================= */

function wireVendorProductActions() {
  document.querySelectorAll(".vendor-products-grid").forEach((grid) => {
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const card = btn.closest(".vendor-product-card");
      const productId = card ? card.dataset.productId : null;
      const product = productId && window.VetraVendorProducts ? window.VetraVendorProducts.getProduct(productId) : null;
      const name = product ? VetraAPI.escapeHtml(product.name || "") : "this product";

      if (btn.dataset.action === "edit") {
        if (!product) return;
        if (window.VetraAddProduct) window.VetraAddProduct.open(product);
      } else if (btn.dataset.action === "remove") {
        if (!productId) return;
        VendorUI.confirm({
          title: "Remove product",
          bodyHtml: `Remove <span class="confirm-modal-target">${name}</span> from your store?`,
          confirmLabel: "Remove",
          danger: true,
          onConfirm: async () => {
            try {
              await VetraAPI.request(`/products/${productId}`, { method: "DELETE", role: "vendor" });
              if (window.VetraVendorProducts) await window.VetraVendorProducts.reload();
            } catch (err) {
              VendorUI.info({ title: "Couldn't remove product", bodyHtml: err.message });
            }
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
   (set by products-data.js's card renderer); a tab shows/hides cards by
   comparing against it. Exposed as window.VetraProductFilter.reapply()
   so products-data.js can re-run the active filter after a grid reload. */
function wireProductFilterTabs() {
  const tabs = document.getElementById("product-filter-tabs");
  const grids = document.querySelectorAll(".vendor-products-grid");
  if (!tabs || !grids.length) return;

  function apply() {
    const active = tabs.querySelector(".filter-tab.active");
    const filter = active ? active.dataset.filter : "all";
    grids.forEach((grid) => {
      grid.querySelectorAll(".vendor-product-card").forEach((card) => {
        const matches = filter === "all" || card.dataset.category === filter;
        card.hidden = !matches;
      });
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
