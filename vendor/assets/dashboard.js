/* =========================================================
   VETRA — VENDOR DASHBOARD (vendor/dashboard.html, real backend)
   Renders the KPI stat grid and Recent Orders preview from real
   GET /orders/vendor + /products?vendor=<id> data, replacing markup
   that used to ship as permanently-fake numbers and order rows — there
   was no renderVendorStats()/renderVendorOrders() behind the "Filled
   in by..." comments those sections used to carry; nothing ever
   overwrote them. No dedicated vendor-stats aggregate endpoint exists
   yet, so this computes the four cards client-side from the same two
   real lists the rest of the vendor app already fetches — simplest,
   and correct by construction, same reasoning as BACKEND_GUIDE.md's
   note on product sales_count.

   "Store Views" was dropped entirely rather than left fake — there's
   no view-tracking anywhere in the backend, and a fabricated
   engagement number is worse than no card at all.
   ========================================================= */

const DASHBOARD_PACKAGE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>`;

document.addEventListener("DOMContentLoaded", async () => {
  const user = VetraAPI.getUser("vendor");
  if (!user) return;
  await Promise.all([renderVendorStats(user.id), renderVendorRecentOrders(user.id)]);
});

async function renderVendorStats(vendorId) {
  const grid = document.getElementById("vendor-stats");
  if (!grid) return;

  let orders = [];
  let products = [];
  try {
    [orders, products] = await Promise.all([
      VetraAPI.request("/orders/vendor", { method: "GET", role: "vendor" }),
      VetraAPI.request(`/products?vendor=${encodeURIComponent(vendorId)}`),
    ]);
  } catch (err) {
    grid.innerHTML = `<p class="table-empty">Couldn't load stats: ${err.message}</p>`;
    return;
  }

  const nonCancelled = orders.filter((o) => o.status !== "cancelled");
  const totalRevenue = nonCancelled.reduce((sum, o) => sum + o.total, 0);
  const activeProducts = products.filter((p) => p.status === "active");
  const outOfStockCount = activeProducts.filter((p) => p.stock_quantity === 0).length;

  const cards = [
    {
      label: "Total Revenue",
      value: formatNaira(totalRevenue),
      tint: "green",
      icon: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h3v-4z"></path>',
    },
    {
      label: "Orders",
      value: nonCancelled.length.toLocaleString(),
      tint: "blue",
      icon: '<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"></path><path d="M8 7h8M8 11h8M8 15h5"></path>',
    },
    {
      label: "Active Listings",
      value: activeProducts.length.toLocaleString(),
      tint: "purple",
      sub: outOfStockCount > 0 ? `${outOfStockCount} out of stock` : null,
      icon: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><path d="M3.27 6.96 12 12l8.73-5.04"></path><path d="M12 22.08V12"></path>',
    },
  ];

  grid.innerHTML = `
    <div class="stat-grid">
      ${cards
        .map(
          (c) => `
        <div class="stat-card">
          <div class="stat-card-head">
            <p class="stat-label">${c.label}</p>
            <span class="stat-icon tint-${c.tint}">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${c.icon}</svg>
            </span>
          </div>
          <p class="stat-value">${c.value}</p>
          ${c.sub ? `<span class="stat-trend" style="color: var(--muted)">${c.sub}</span>` : ""}
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function formatDashboardOrderTimestamp(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

async function renderVendorRecentOrders() {
  const list = document.getElementById("vendor-recent-orders-list");
  if (!list) return;

  list.innerHTML = `<p class="vendor-products-empty">Loading orders…</p>`;
  try {
    const orders = await VetraAPI.request("/orders/vendor", { method: "GET", role: "vendor" });
    if (!orders.length) {
      list.innerHTML = `<p class="vendor-products-empty">No orders yet.</p>`;
      return;
    }
    list.innerHTML = orders
      .slice(0, 3)
      .map((order) => {
        const items = Array.isArray(order.items) ? order.items : [];
        const itemsLabel = items.length
          ? items.map((i) => `${i.name || "Item"}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ")
          : "Order";
        const slug = orderStatusSlug(order.status);
        return `
          <div class="order-item">
            <div class="stat-icon">${DASHBOARD_PACKAGE_ICON}</div>
            <div class="order-info">
              <p class="order-id">${formatOrderRef(order.id)} &middot; ${order.buyer_name || "Guest"}</p>
              <p class="order-meta">${itemsLabel} — ${formatDashboardOrderTimestamp(order.created_at)}</p>
            </div>
            <div class="order-side">
              <p class="order-amount">${formatNaira(order.total)}</p>
              <span class="status-pill ${slug}">${ORDER_STATUS_LABEL[order.status] || order.status}</span>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    list.innerHTML = `<p class="vendor-products-empty">Couldn't load orders: ${err.message}</p>`;
  }
}
