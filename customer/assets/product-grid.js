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
  // null/undefined (data unavailable) means no cap — see the same
  // fallback reasoning in product.html/cart.js's own qty steppers.
  const stockAvailable = product.stock_quantity == null ? Infinity : Number(product.stock_quantity);
  card.dataset.stock = String(stockAvailable);

  const images = Array.isArray(product.images) ? product.images : [];
  const image = images[0] || "assets/images/product-placeholder.jpg";
  const name = escapeHtmlForCard(product.name || "");
  const vendorName = product.vendor_name ? escapeHtmlForCard(product.vendor_name) : "";
  const vendorLine = vendorName
    ? `<p class="product-vendor">${vendorName} ${verifiedBadgeMarkup(product.vendor_kyc_verified)}</p>`
    : "";

  // Color/storage and description are optional (only phones/laptops/
  // tablets tend to set the first two) — each is CSS-clamped rather
  // than JS-truncated, so a long value always fades into an ellipsis
  // instead of stretching the card or wrapping into other cards'
  // rows, regardless of exactly how long it is.
  const specParts = [product.color, product.storage].filter(Boolean).map(escapeHtmlForCard);
  const specsLine = specParts.length ? `<p class="product-specs">${specParts.join(" · ")}</p>` : "";
  const descLine = product.description
    ? `<p class="product-desc-preview">${escapeHtmlForCard(product.description)}</p>`
    : "";

  card.innerHTML = `
    <div class="img-placeholder product-img">
      <img src="${image}" alt="${name}"
        onerror="this.style.display='none'; this.parentElement.insertAdjacentHTML('beforeend', '<span>${name}</span>');" />
    </div>
    <div class="product-body">
      <p class="product-name">${name}</p>
      ${vendorLine}
      ${specsLine}
      ${descLine}
      <p class="product-price">${formatNaira(product.price)}</p>
      <div class="product-qty-stepper">
        <button type="button" class="qty-btn product-qty-decrement" aria-label="Decrease quantity">−</button>
        <span class="product-qty-value">1</span>
        <button type="button" class="qty-btn product-qty-increment" aria-label="Increase quantity" ${stockAvailable <= 1 ? "disabled" : ""}>+</button>
      </div>
      <button class="add-cart">Add to Cart</button>
    </div>
  `;

  // Wired directly on this card's own buttons (rather than a page-wide
  // delegated listener) since each card owns its own independent qty
  // state — capped at stock, same reasoning as product.html/cart.js.
  const qtyValueEl = card.querySelector(".product-qty-value");
  const incrementBtn = card.querySelector(".product-qty-increment");
  const decrementBtn = card.querySelector(".product-qty-decrement");
  decrementBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = Math.max(1, Number(qtyValueEl.textContent) - 1);
    qtyValueEl.textContent = next;
    incrementBtn.disabled = next >= stockAvailable;
  });
  incrementBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const current = Number(qtyValueEl.textContent);
    if (current >= stockAvailable) return;
    qtyValueEl.textContent = current + 1;
    incrementBtn.disabled = current + 1 >= stockAvailable;
  });

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
