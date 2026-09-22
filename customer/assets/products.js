/* =========================================================
   VETRA: Shared product catalog (customer app, real backend).
   Replaces the old hard-coded PRODUCTS object with a real cache
   fetched from GET /api/products. Every price value here is kobo,
   exactly as the database stores it (see api-client.js's Money
   helpers), nothing in this file converts it; formatNaira() at
   render time is the only place that happens.

   getProduct(id) stays synchronous so badges.js/cart-store.js don't
   need to change: a page must actually load a product (via
   VetraCatalog.load() or .loadOne()) before relying on getProduct()
   to resolve it, same ordering requirement the old static object
   satisfied for free, just explicit now instead of implicit.
   ========================================================= */

const VetraCatalog = (() => {
  const productsById = {};

  function cache(row) {
    productsById[row.id] = row;
    return row;
  }

  // ?vendor=<id>, ?category=<name>, ?q=<text>: all optional, matching
  // GET /api/products' own filters. Omit all three for the full public
  // catalog (approved vendors only, see backend/src/routes/products.routes.js).
  async function load(params = {}) {
    const qs = new URLSearchParams();
    if (params.vendor) qs.set("vendor", params.vendor);
    if (params.category) qs.set("category", params.category);
    if (params.q) qs.set("q", params.q);
    const path = "/products" + (qs.toString() ? `?${qs}` : "");
    const rows = await VetraAPI.request(path);
    rows.forEach(cache);
    return rows;
  }

  async function loadOne(id) {
    const row = await VetraAPI.request(`/products/${id}`);
    return cache(row);
  }

  function getProduct(id) {
    return productsById[id] || null;
  }

  return { load, loadOne, getProduct };
})();

// Bare `getProduct` is what badges.js/cart-store.js/purchase-history.js
// already call, kept as a thin wrapper so those files don't need to
// change just because the catalog moved from an object literal to a
// fetched cache.
function getProduct(id) {
  return VetraCatalog.getProduct(id);
}

/* =========================================================
   Product badges ("New" / "Hot").
   "New": created within the last 21 days (created_at, a real
   row-creation timestamp). "Hot": sales_count (a real aggregate
   over completed orders, computed server-side in
   backend/src/routes/products.routes.js) at or above the threshold.
   A card shows at most one, "New" wins if a product qualifies for
   both.
   ========================================================= */
const BADGE_NEW_WINDOW_DAYS = 21;
const BADGE_HOT_SALES_THRESHOLD = 50;

function getProductBadge(product) {
  if (!product) return null;

  if (product.created_at) {
    const ageMs = Date.now() - new Date(product.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays >= 0 && ageDays <= BADGE_NEW_WINDOW_DAYS) {
      return { type: "new", label: "New" };
    }
  }

  if (Number(product.sales_count) >= BADGE_HOT_SALES_THRESHOLD) {
    return { type: "hot", label: "Hot" };
  }

  return null;
}

window.VetraCatalog = VetraCatalog;
