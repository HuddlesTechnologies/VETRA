/* =========================================================
   VETRA: Product badge rendering.

   Applies the "New"/"Hot" decision from getProductBadge()
   (assets/products.js) to the DOM. Replaces the old hand-typed
   badge spans that only existed on explore.html with one
   data-driven pass that runs the same way on every page.

   Call decorateProductBadges() once a page's product cards exist,
   on DOMContentLoaded for static cards (dashboard.html, explore.html),
   or right after the grid renders for JS-built cards (store.html).
   Safe to call more than once, it clears any badge it previously
   added before recomputing.
   ========================================================= */

function decorateProductBadges(root) {
  const scope = root || document;
  const cards = scope.querySelectorAll("[data-product-id]");

  cards.forEach((card) => {
    const productId = card.dataset.productId;
    const product = typeof getProduct === "function" ? getProduct(productId) : null;

    const thumb = card.querySelector(".product-img, .product-thumb");
    if (!thumb) return;

    const existing = thumb.querySelector(".product-badge");
    if (existing) existing.remove();

    const badge = typeof getProductBadge === "function" ? getProductBadge(product) : null;
    if (!badge) return;

    const el = document.createElement("span");
    el.className = `product-badge ${badge.type}`;
    el.textContent = badge.label;
    thumb.insertBefore(el, thumb.firstChild);
  });
}
