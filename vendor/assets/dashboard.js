/* =========================================================
   VETRA — VENDOR DASHBOARD PAGE INTERACTIONS
   Page-specific script for vendor/dashboard.html only.

   Stats / recent orders / product grid are now static markup in
   dashboard.html itself (see #vendor-stats, #vendor-orders,
   #vendor-products). This file only wires up the still-interactive
   bits: the product Edit/Remove buttons and the Add Product
   shortcut. Replace the TODOs with real navigation / API calls
   once the backend is ready.
   ========================================================= */

function wireVendorProductActions() {
  const grid = document.querySelector("#vendor-products .vendor-products-grid");
  if (!grid) return;

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
