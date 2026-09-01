/* =========================================================
   VETRA — VENDOR PRODUCTS PAGE INTERACTIONS
   Page-specific script for vendor/products.html only.

   The full catalog is static markup in products.html itself.
   This file only wires up the Edit/Remove buttons and the
   Add Product shortcut. Replace the TODOs with real navigation
   / API calls once the backend is ready.
   ========================================================= */

function wireVendorProductActions() {
  const grid = document.querySelector(".vendor-products-grid");
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
    // TODO: replace with real navigation once an add-product page exists.
    // window.location.href = "add-product.html";
    alert("Hook this up to your add-product page.");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireVendorProductActions();
  wireAddProductButton();
});
