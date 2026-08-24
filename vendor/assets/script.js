/* =========================================================
   VETRA — VENDOR DASHBOARD SCRIPT
   Page-specific script for vendor/dashboard.html only.

   Depends on js/layout.js being loaded FIRST (this file reuses
   Vetra.renderHeader / Vetra.renderSidebar / Vetra.renderBottomNav
   and the Vetra.icons / Vetra.icons2 icon sets from that file).

   HOW TO USE / EDIT LATER:
   - VENDOR_NAV_ITEMS   -> sidebar + bottom-nav links for vendor pages.
                           "Support" was moved out of here and into the
                           header (see PAGE INIT below); "Profile" now
                           sits in its place, on both mobile and desktop.
   - DUMMY_VENDOR_STATS -> the 4 stat cards at the top of the page.
   - DUMMY_ORDERS       -> "Recent orders" list.
   - DUMMY_VENDOR_PRODUCTS -> "My products" grid.
   Replace the dummy data with real data (e.g. from an API call)
   once the backend is ready — the render functions below don't
   need to change, only the arrays passed into them.
   ========================================================= */

/* ---------- VENDOR SIDEBAR / BOTTOM NAV LINKS ----------
   Separate from the buyer nav in js/layout.js. Passed in as
   "customItems" to Vetra.renderSidebar()/renderBottomNav() so
   the shared layout file stays untouched for buyer pages.

   Note: "Support" used to live here (as a "contact" item). It's
   been moved to the header (see wireHeaderSupportButton() below,
   wired via Vetra.renderHeader(..., { showSupport: true })), and
   "Profile" takes its old spot in the nav — same position, both
   in the desktop sidebar and the mobile bottom-nav, since both
   read from this same array. */
const VENDOR_NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: Vetra.icons.home, href: "dashboard.html" },
  { key: "products", label: "Products", icon: Vetra.icons.box, href: "products.html" },
  { key: "orders", label: "Orders", icon: Vetra.icons.receipt, href: "orders.html" },
  { key: "earnings", label: "Earnings", icon: Vetra.icons.wallet, href: "earnings.html" },
  { key: "profile", label: "Profile", icon: Vetra.icons.profile, href: "profile.html" },

];

/* ---------- DUMMY DATA ----------
   Replace with real vendor data once the backend/API is wired up. */

// stats: [{ label, value, icon, trend: "up"|"down"|null, trendLabel }]
const DUMMY_VENDOR_STATS = [
  { label: "Total Revenue", value: "₦1,284,300", icon: Vetra.icons.wallet, },
  { label: "Orders", value: "58", icon: Vetra.icons.receipt, },
  { label: "Active Listings", value: "24", icon: Vetra.icons.box, trend: null, trendLabel: "2 out of stock" },
  { label: "Store Views", value: "3,410", icon: Vetra.icons.eye, }
];

// orders: [{ id, buyer, product, amount, status, date }]
// status: "pending" | "processing" | "completed" | "cancelled"
const DUMMY_ORDERS = [
  { id: "#VE-10432", buyer: "Amaka O.", product: "Oraimo Power bank 250...", amount: "₦17,489", status: "pending", date: "Today, 10:24am" },
  { id: "#VE-10431", buyer: "Tunde A.", product: "Wireless Earbuds Pro", amount: "₦22,000", status: "processing", date: "Today, 8:02am" },
  { id: "#VE-10428", buyer: "Chidera N.", product: "Smart LED Desk Lamp", amount: "₦9,750", status: "completed", date: "Yesterday" },
  { id: "#VE-10425", buyer: "Bola S.", product: "USB-C Fast Charger", amount: "₦6,200", status: "cancelled", date: "2 days ago" },
  { id: "#VE-10420", buyer: "Ifeoma K.", product: "Bluetooth Speaker Mini", amount: "₦14,900", status: "completed", date: "3 days ago" }
];

// products: [{ image, name, price, stock }]
const DUMMY_VENDOR_PRODUCTS = [
  { image: "assets/images/products/product-1.jpg", name: "Oraimo Power bank 250...", price: "₦17,489", stock: 18 },
  { image: "assets/images/products/product-2.jpg", name: "Wireless Earbuds Pro", price: "₦22,000", stock: 4 },
  { image: "assets/images/products/product-3.jpg", name: "Smart LED Desk Lamp", price: "₦9,750", stock: 0 },
  { image: "assets/images/products/product-4.jpg", name: "USB-C Fast Charger", price: "₦6,200", stock: 32 },
  { image: "assets/images/products/product-5.jpg", name: "Bluetooth Speaker Mini", price: "₦14,900", stock: 11 },
  { image: "assets/images/products/product-6.jpg", name: "Ergonomic Mouse", price: "₦11,300", stock: 3 }
];

/* Reuses the same dashed placeholder box as the buyer layout, so
   product thumbnails look identical across buyer/vendor pages. */
function vendorPlaceholderImg(src, alt, extraClass = "") {
  return `<div class="img-placeholder ${extraClass}">
    <img src="${src}" alt="${alt}" onerror="this.style.display='none'; this.parentElement.insertAdjacentHTML('beforeend', '<span>${alt}</span>')">
  </div>`;
}

/* ---------- STAT CARDS ---------- */
function renderVendorStats(stats, target = "#vendor-stats") {
  const el = document.querySelector(target);
  if (!el) return;
  el.innerHTML = `
    <div class="stat-grid">
      ${stats.map(s => `
        <div class="stat-card">
          <div class="stat-card-head">
            <p class="stat-label">${s.label}</p>
            <span class="stat-icon">${s.icon}</span>
          </div>
          <p class="stat-value">${s.value}</p>
          ${s.trend ? `
            <span class="stat-trend ${s.trend}">
              ${s.trend === "up" ? Vetra.icons.trend : Vetra.icons.trendDown}
              ${s.trendLabel}
            </span>
          ` : s.trendLabel ? `<span class="stat-trend" style="color: var(--muted);">${s.trendLabel}</span>` : ''}
        </div>
      `).join("")}
    </div>
  `;
}

/* ---------- RECENT ORDERS ---------- */
function renderVendorOrders(orders, target = "#vendor-orders") {
  const el = document.querySelector(target);
  if (!el) return;

  if (!orders.length) {
    el.innerHTML = `
      <div class="cat-head"><h3>RECENT ORDERS</h3></div>
      <div class="vendor-empty">No orders yet. New orders will show up here.</div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="cat-head">
      <h3>RECENT ORDERS</h3>
      <button class="see-more" id="orders-see-more">See all</button>
    </div>
    <div class="order-list">
      ${orders.map(o => `
        <div class="order-item">
          <div class="stat-icon">${Vetra.icons.receipt}</div>
          <div class="order-info">
            <p class="order-id">${o.id} &middot; ${o.buyer}</p>
            <p class="order-meta">${o.product} — ${o.date}</p>
          </div>
          <div class="order-side">
            <p class="order-amount">${o.amount}</p>
            <span class="status-pill ${o.status}">${o.status}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  // TODO: wire this up once an orders.html page / full order list exists.
  const seeMoreBtn = document.getElementById("orders-see-more");
  if (seeMoreBtn) {
    seeMoreBtn.addEventListener("click", () => {
      window.location.href = "orders.html";
    });
  }
}

/* ---------- MY PRODUCTS ---------- */
function renderVendorProducts(products, target = "#vendor-products") {
  const el = document.querySelector(target);
  if (!el) return;

  if (!products.length) {
    el.innerHTML = `
      <div class="cat-head"><h3>MY PRODUCTS</h3></div>
      <div class="vendor-empty">You haven't listed any products yet.</div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="cat-head">
      <h3>MY PRODUCTS</h3>
      <button class="see-more" id="products-see-more">See all</button>
    </div>
    <div class="vendor-products-grid">
      ${products.map((p, i) => `
        <div class="vendor-product-card" data-product-index="${i}">
          ${vendorPlaceholderImg(p.image, p.name, "product-img")}
          <span class="stock-pill ${p.stock === 0 || p.stock <= 5 ? "low" : ""}">
            ${p.stock === 0 ? "Out of stock" : p.stock + " in stock"}
          </span>
          <div class="product-body">
            <p class="product-name">${p.name}</p>
            <p class="product-price">${p.price}</p>
          </div>
          <div class="vendor-actions">
            <button class="edit-btn" data-action="edit" data-product-index="${i}">Edit</button>
            <button class="remove-btn" data-action="remove" data-product-index="${i}">Remove</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  // TODO: wire "See all" to products.html once that page exists.
  const seeMoreBtn = document.getElementById("products-see-more");
  if (seeMoreBtn) {
    seeMoreBtn.addEventListener("click", () => {
      window.location.href = "products.html";
    });
  }

  // Edit / Remove button handlers — replace the TODOs with real
  // API calls (or navigation to an edit-product page) later.
  el.querySelectorAll(".vendor-actions button").forEach(btn => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.productIndex);
      const product = products[index];
      if (btn.dataset.action === "edit") {
        // TODO: replace with real navigation, e.g.
        // window.location.href = `edit-product.html?id=${product.id}`;
        alert(`Edit "${product.name}" — hook this up to your edit-product page.`);
      } else if (btn.dataset.action === "remove") {
        // TODO: replace with a real delete API call + confirmation modal.
        const confirmed = confirm(`Remove "${product.name}" from your store?`);
        if (confirmed) {
          products.splice(index, 1);
          renderVendorProducts(products, target);
        }
      }
    });
  });
}

/* ---------- ADD PRODUCT BUTTON ---------- */
function wireAddProductButton() {
  const btn = document.getElementById("add-product-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // TODO: replace with real navigation once an add-product page exists.
    // window.location.href = "add-product.html";
    alert("Hook this up to your add-product page.");
  });
}

/* ---------- HEADER SUPPORT BUTTON ----------
   The support link now renders inside the header (both mobile and
   desktop, since js/layout.js's renderHeader() is shared across
   both) instead of in the sidebar/bottom-nav. Hook this up to your
   real support flow (a chat widget, a support.html page, etc.). */
function wireHeaderSupportButton() {
  const btn = document.getElementById("header-support-btn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    // TODO: replace with real navigation or a support/chat widget, e.g.
    // window.location.href = "support.html";
    alert("Hook this up to your support flow.");
  });
}

/* ---------- PAGE INIT ---------- */
document.addEventListener("DOMContentLoaded", () => {
  Vetra.renderHeader("#app-header", { showSupport: true });
  Vetra.renderSidebar("dashboard", "#app-sidebar", VENDOR_NAV_ITEMS);
  Vetra.renderBottomNav("dashboard", "#app-bottomnav", VENDOR_NAV_ITEMS);

  renderVendorStats(DUMMY_VENDOR_STATS);
  renderVendorOrders(DUMMY_ORDERS);
  renderVendorProducts(DUMMY_VENDOR_PRODUCTS);
  wireAddProductButton();
  wireHeaderSupportButton();
});