/* =========================================================
   VETRA — SHARED PRODUCT GRID RENDERER (customer app)
   Builds the same `.product` card markup dashboard.html/explore.html/
   store.html used to ship as static HTML, now from a real product row
   (assets/products.js's VetraCatalog). Used by all three pages so a
   layout change only has to happen once.

   data-price is kept in NAIRA (not kobo) on purpose — assets/filters.js's
   price-range checkboxes ("0-5000", "50000-0", etc.) are naira-scale and
   untouched by this backend wiring; only the visible price text uses
   formatNaira's kobo-aware conversion.

   There's no per-product location in the database (the old mock data's
   "location" was decorative), so that line is simply omitted rather than
   inventing one.
   ========================================================= */

function escapeHtmlForCard(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCustomerProductCard(product) {
  const card = document.createElement("div");
  card.className = "product";
  card.dataset.productId = product.id;
  if (product.category) card.dataset.category = product.category;
  card.dataset.price = String(Math.round(product.price / 100));
  card.dataset.name = product.name || "";

  const images = Array.isArray(product.images) ? product.images : [];
  const image = images[0] || "assets/images/product-placeholder.jpg";
  const name = escapeHtmlForCard(product.name || "");

  card.innerHTML = `
    <div class="img-placeholder product-img">
      <img src="${image}" alt="${name}"
        onerror="this.style.display='none'; this.parentElement.insertAdjacentHTML('beforeend', '<span>${name}</span>');" />
    </div>
    <div class="product-body">
      <p class="product-name">${name}</p>
      <p class="product-price">${formatNaira(product.price)}</p>
      <button class="add-cart">Add to Cart</button>
    </div>
  `;
  return card;
}

// Renders `products` into `grid`, replacing its current contents (a
// "Loading…" placeholder, or a previous render). Calls
// decorateProductBadges()/Vetra.wireProductCardClicks() follow-ups the
// same way the old static markup relied on running once at parse time —
// here they need to re-run per render instead.
function renderCustomerProductGrid(products, grid, emptyMessage) {
  if (!grid) return;
  grid.innerHTML = "";
  if (!products.length) {
    grid.innerHTML = `<p class="products-empty-state">${emptyMessage || "No products yet."}</p>`;
    return;
  }
  products.forEach((p) => grid.appendChild(buildCustomerProductCard(p)));
  if (typeof decorateProductBadges === "function") decorateProductBadges(grid);
  if (typeof Vetra !== "undefined") Vetra.updateCartBadge();
}
