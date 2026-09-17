/* =========================================================
   VETRA — VENDOR ORDERS PAGE (real backend)
   Renders real orders from GET /api/orders/vendor (assets/
   order-tracking.js's sibling — see backend/src/routes/orders.routes.js),
   replacing the static mock rows. Same status-filter-tabs +
   "Show more" capping behavior as before, now wired to real data.

   Status is stored with underscores (out_for_delivery) but the
   existing CSS/tab markup uses hyphens (status-pill.out-for-delivery,
   data-filter="out-for-delivery") — orderStatusSlug() (api-client.js)
   is the one place that conversion happens; order-tracking.js
   converts back the other way before it PATCHes. ORDER_STATUS_LABEL
   is also shared from there.
   ========================================================= */

const ORDERS_MAX_VISIBLE = 5;

const PACKAGE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>`;

function formatOrderTimestamp(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// The expand panel's contents — itemized products (name/qty/price/
// image) plus the customer's contact details (name, phone, delivery
// address), so a vendor can see exactly what was ordered and who to
// reach without leaving the orders list. buyer_phone/delivery_address
// come from GET /api/orders/vendor (see backend/src/routes/
// orders.routes.js) — a signed-in buyer's account phone or a guest's
// own phone, and this specific order's delivery address.
function buildOrderDetailPanel(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.length
    ? items
        .map(
          (i) => `
        <div class="order-detail-item">
          <img class="order-detail-item-img" src="${i.image || "imgs/product-placeholder.jpg"}" alt="" />
          <div>
            <p class="order-detail-item-name">${escapeHtml(i.name || "Item")}</p>
            <p class="order-detail-item-meta">Qty ${i.quantity || 1} &middot; ${formatNaira(i.priceAtPurchase)}</p>
          </div>
        </div>`
        )
        .join("")
    : `<p class="order-detail-empty">No item details available.</p>`;

  const customerRows = [
    ["Name", order.buyer_name || "Guest"],
    ["Phone", order.buyer_phone || "—"],
    ["Delivery address", order.delivery_address || "—"],
  ]
    .map(([label, value]) => `<p class="order-detail-customer-row"><span>${label}</span>${escapeHtml(value)}</p>`)
    .join("");

  return `
    <div class="order-detail-panel" hidden>
      <div class="order-detail-section">
        <p class="order-detail-heading">Items</p>
        ${itemsHtml}
      </div>
      <div class="order-detail-section">
        <p class="order-detail-heading">Customer</p>
        ${customerRows}
      </div>
    </div>
  `;
}

function buildVendorOrderRow(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsLabel = items.length
    ? items.map((i) => `${i.name || "Item"}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ")
    : "Order";
  const slug = orderStatusSlug(order.status);
  const hasTracking = order.carrier || order.tracking_number;

  const row = document.createElement("div");
  row.className = "order-item";
  row.dataset.status = slug;
  row.dataset.orderId = order.id;
  row.dataset.carrier = order.carrier || "";
  row.dataset.tracking = order.tracking_number || "";

  row.innerHTML = `
    <div class="stat-icon">${PACKAGE_ICON}</div>
    <div class="order-info">
      <p class="order-id">${formatOrderRef(order.id)} &middot; ${order.buyer_name || "Guest"}</p>
      <p class="order-meta">${itemsLabel} — ${formatOrderTimestamp(order.created_at)}</p>
      ${hasTracking ? `<p class="order-tracking-line">${[order.carrier, order.tracking_number].filter(Boolean).join(" · ")}</p>` : ""}
      <button type="button" class="order-manage-btn">Update shipment</button>
    </div>
    <div class="order-side">
      <p class="order-amount">${formatNaira(order.total)}</p>
      <span class="status-pill ${slug}">${ORDER_STATUS_LABEL[order.status] || order.status}</span>
      <svg class="order-expand-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </div>
    ${buildOrderDetailPanel(order)}
  `;
  return row;
}

// Tapping anywhere on a row (other than the "Update shipment" button,
// which already has its own handler in order-tracking.js) toggles that
// row's detail panel — product line items + customer contact info.
// Delegated on the list so it keeps working after loadAndRenderVendorOrders()
// re-renders rows or order-tracking.js patches one in place.
function wireOrderRowExpand(list) {
  list.addEventListener("click", (e) => {
    if (e.target.closest(".order-manage-btn")) return;
    const row = e.target.closest(".order-item");
    if (!row) return;
    const panel = row.querySelector(".order-detail-panel");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    row.classList.toggle("expanded", !panel.hidden);
  });
}

async function loadAndRenderVendorOrders() {
  const list = document.getElementById("order-list");
  if (!list) return;

  list.innerHTML = `<p class="vendor-products-empty">Loading orders…</p>`;
  try {
    const orders = await VetraAPI.request("/orders/vendor", { method: "GET", role: "vendor" });
    if (!orders.length) {
      list.innerHTML = `<p class="vendor-products-empty">No orders yet.</p>`;
      return;
    }
    list.innerHTML = "";
    orders.forEach((o) => list.appendChild(buildVendorOrderRow(o)));
  } catch (err) {
    list.innerHTML = `<p class="vendor-products-empty">Couldn't load orders: ${err.message}</p>`;
  }
}

function wireOrderFilterTabs() {
  const tabs = document.getElementById("order-filter-tabs");
  const list = document.getElementById("order-list");
  const showMoreBtn = document.getElementById("orders-show-more-btn");
  if (!tabs || !list) return;

  let currentFilter = "all";
  let expanded = false;

  function applyVisibility() {
    const rows = Array.from(list.querySelectorAll(".order-item"));
    const matching = rows.filter(
      (row) => currentFilter === "all" || row.dataset.status === currentFilter
    );
    const visibleCount = expanded ? matching.length : Math.min(ORDERS_MAX_VISIBLE, matching.length);
    const visibleRows = matching.slice(0, visibleCount);

    rows.forEach((row) => {
      row.style.display = visibleRows.includes(row) ? "" : "none";
    });

    if (showMoreBtn) {
      const remaining = matching.length - visibleCount;
      showMoreBtn.hidden = remaining <= 0;
      if (remaining > 0) {
        showMoreBtn.textContent = `Show ${remaining} more order${remaining === 1 ? "" : "s"}`;
      }
    }
  }

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tab");
    if (!btn) return;

    tabs.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    currentFilter = btn.dataset.filter;
    expanded = false;
    applyVisibility();
  });

  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", () => {
      expanded = true;
      applyVisibility();
    });
  }

  // Exposed so order-tracking.js can re-run visibility after a real
  // PATCH changes a row's status (the "all" filter's cap shouldn't
  // change, but a specific status filter might now exclude that row).
  window.VetraVendorOrderFilters = { applyVisibility };
  applyVisibility();
}

document.addEventListener("DOMContentLoaded", async () => {
  const list = document.getElementById("order-list");
  await loadAndRenderVendorOrders();
  wireOrderFilterTabs();
  if (list) wireOrderRowExpand(list);
});
