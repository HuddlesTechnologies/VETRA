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
        alert(`Edit "${name}" — hook this up to your edit-product page.`);
      } else if (btn.dataset.action === "remove") {
        // TODO: replace with a real delete API call + confirmation modal.
        const confirmed = confirm(`Remove "${name}" from your store?`);
        if (confirmed && card) card.remove();
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

document.addEventListener("DOMContentLoaded", () => {
  wireVendorProductActions();
  wireAddProductButton();
});
