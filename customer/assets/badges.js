/* =========================================================
   VETRA — PRODUCT BADGE RENDERING
   Takes the "New"/"Hot" decision computed by getProductBadge()
   (assets/products.js) and applies it to the DOM. Previously these
   badges were 5 hand-typed <span class="product-badge hot/new">
   elements scattered on explore.html only — a product showed one
   there and nothing on dashboard.html/store.html, with no logic
   behind which products got one. This replaces all of that with one
   real, data-driven pass that runs identically on every page.

   Call decorateProductBadges() once after a page's product cards
   exist in the DOM — on DOMContentLoaded for pages whose cards are
   static HTML (dashboard.html, explore.html), or right after the
   grid is rendered for pages that build cards from JS (store.html).
   Safe to call more than once (e.g. after a re-render): it clears
   any badge it previously added before recomputing.
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
