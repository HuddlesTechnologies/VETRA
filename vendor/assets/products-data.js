/* =========================================================
   VETRA: Vendor product grid (real data).
   Shared by vendor/dashboard.html (a capped preview) and
   vendor/products.html (the full grid), replaces the static
   hard-coded product cards both pages used to ship with a real
   fetch against GET /api/products?vendor=<this vendor's id>.

   Keeps a productsById map in memory so add-product.js (edit mode)
   and product-actions.js (edit/remove) can look a product up by the
   id on its card without a second round trip.
   ========================================================= */

const VetraVendorProducts = (() => {
  let productsById = {};
  let lastOptions = null;

  function stockPillMarkup(stock) {
    const isLow = stock === 0 || stock <= 5;
    const text = stock === 0 ? "Out of stock" : `${stock} in stock`;
    return `<span class="stock-pill${isLow ? " low" : ""}">${text}</span>`;
  }

  function buildProductCard(product) {
    const card = document.createElement("div");
    card.className = "vendor-product-card";
    card.dataset.productId = product.id;
    if (product.category) card.dataset.category = product.category;
    const images = Array.isArray(product.images) ? product.images : [];
    const imageUrl = images[0] || "assets/images/product-placeholder.jpg";
    const name = product.name || "";
    card.innerHTML = `
      <div class="img-placeholder product-img">
        <img src="${imageUrl}" alt="${VetraAPI.escapeHtml(name)}"
          onerror="this.style.display='none'; this.parentElement.insertAdjacentHTML('beforeend', '<span>${VetraAPI.escapeHtml(name)}</span>');" />
      </div>
      ${stockPillMarkup(product.stock_quantity)}
      <div class="product-body">
        ${product.category ? `<p class="product-category">${VetraAPI.escapeHtml(product.category)}</p>` : ""}
        <p class="product-name">${VetraAPI.escapeHtml(name)}</p>
        <p class="product-price">${formatNaira(product.price)}</p>
      </div>
      <div class="vendor-actions">
        <button class="edit-btn" data-action="edit" type="button">Edit</button>
        <button class="remove-btn" data-action="remove" type="button">Remove</button>
      </div>
    `;
    return card;
  }

  function render(products, grid, emptyMessage) {
    grid.innerHTML = "";
    if (!products.length) {
      grid.innerHTML = `<p class="vendor-products-empty">${emptyMessage || `You haven't listed any products yet, click "Add Product" to get started.`}</p>`;
      return;
    }
    products.forEach((p) => grid.appendChild(buildProductCard(p)));
    if (window.VetraProductFilter) window.VetraProductFilter.reapply();
  }

  async function load(options = {}) {
    lastOptions = options;
    const { limit } = options;
    const inStockGrid = document.querySelector('.vendor-products-grid[data-stock-section="in-stock"]');
    const outOfStockGrid = document.querySelector('.vendor-products-grid[data-stock-section="out-of-stock"]');
    // products.html has both sections; dashboard.html's single preview
    // grid carries neither data-stock-section attribute and keeps showing
    // everything (in and out of stock) in one place, unsplit.
    const splitByStock = inStockGrid && outOfStockGrid;
    const grid = splitByStock ? null : document.querySelector(".vendor-products-grid");
    if (!splitByStock && !grid) return;

    const user = VetraAPI.getUser("vendor");
    if (!user) return;

    if (splitByStock) {
      inStockGrid.innerHTML = `<p class="vendor-products-empty">Loading your products…</p>`;
      outOfStockGrid.innerHTML = "";
    } else {
      grid.innerHTML = `<p class="vendor-products-empty">Loading your products…</p>`;
    }
    try {
      const query = splitByStock ? "&includeOutOfStock=1" : "";
      const products = await VetraAPI.request(`/products?vendor=${encodeURIComponent(user.id)}${query}`);
      products.forEach((p) => (productsById[p.id] = p));

      if (splitByStock) {
        const inStock = products.filter((p) => Number(p.stock_quantity) > 0);
        const outOfStock = products.filter((p) => Number(p.stock_quantity) <= 0);
        render(inStock, inStockGrid);
        render(outOfStock, outOfStockGrid, "No out-of-stock products.");
      } else {
        const shown = limit ? products.slice(0, limit) : products;
        render(shown, grid);
      }
    } catch (err) {
      const message = `<p class="vendor-products-empty">Couldn't load your products: ${VetraAPI.escapeHtml(err.message)}</p>`;
      if (splitByStock) {
        inStockGrid.innerHTML = message;
        outOfStockGrid.innerHTML = message;
      } else {
        grid.innerHTML = message;
      }
    }
  }

  function reload() {
    return load(lastOptions || {});
  }

  function getProduct(id) {
    return productsById[id] || null;
  }

  return { load, reload, getProduct, formatNaira };
})();

// `const` at top level doesn't attach to `window` the way `var` does,
// add-product.js and product-actions.js check `window.VetraVendorProducts`,
// so expose it explicitly (see add-product.js's own note on this).
window.VetraVendorProducts = VetraVendorProducts;

// Auto-loads on any page carrying a `.vendor-products-grid`, an optional
// `data-limit` attribute caps how many show (dashboard.html's preview);
// products.html omits it to show the full catalog.
document.addEventListener("DOMContentLoaded", () => {
  const grid = document.querySelector(".vendor-products-grid");
  if (!grid) return;
  const limit = grid.dataset.limit ? Number(grid.dataset.limit) : undefined;
  VetraVendorProducts.load({ limit });
});
