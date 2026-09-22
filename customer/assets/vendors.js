/* =========================================================
   VETRA: Shared vendor directory (customer app, real backend).
   Replaces the old hard-coded VENDORS object with a real cache
   fetched from GET /api/vendors (list) / GET /api/vendors/:id
   (single), see backend/src/routes/vendors.routes.js. Same
   getVendor(id)-stays-synchronous pattern as assets/products.js:
   load a vendor first, then read it back.
   ========================================================= */

const VetraVendorDirectory = (() => {
  const vendorsById = {};

  function cache(row) {
    vendorsById[row.id] = row;
    return row;
  }

  async function load(params = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    const path = "/vendors" + (qs.toString() ? `?${qs}` : "");
    const rows = await VetraAPI.request(path);
    rows.forEach(cache);
    return rows;
  }

  async function loadOne(id) {
    const row = await VetraAPI.request(`/vendors/${id}`);
    return cache(row);
  }

  function getVendor(id) {
    return vendorsById[id] || null;
  }

  return { load, loadOne, getVendor };
})();

window.VetraVendorDirectory = VetraVendorDirectory;
