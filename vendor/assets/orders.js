/* =========================================================
   VETRA — VENDOR ORDERS PAGE (real backend)
   Renders real orders from GET /api/orders/vendor (assets/
   order-tracking.js's sibling — see backend/src/routes/orders.routes.js),
   replacing the static mock rows. Same status-filter-tabs +
   "Show more" capping behavior as before, now wired to real data.

   Status is stored with underscores (out_for_delivery) but the
   existing CSS/tab markup uses hyphens (status-pill.out-for-delivery,
   data-filter="out-for-delivery") — statusSlug() is the one place
   that conversion happens; order-tracking.js converts back the other
   way before it PATCHes.
   ========================================================= */

const ORDERS_MAX_VISIBLE = 5;

const VENDOR_ORDER_STATUS_LABEL = {
  pending: "pending",
  processing: "processing",
  shipped: "shipped",
  out_for_delivery: "out for delivery",
  completed: "delivered",
  cancelled: "cancelled",
};

const PACKAGE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>`;

function statusSlug(status) {
  return String(status).replace(/_/g, "-");
}

function formatOrderTimestamp(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function buildVendorOrderRow(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsLabel = items.length
    ? items.map((i) => `${i.name || "Item"}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ")
    : "Order";
  const slug = statusSlug(order.status);
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
      <p class="order-id">#${order.id.slice(0, 8).toUpperCase()} &middot; ${order.buyer_name || "Guest"}</p>
      <p class="order-meta">${itemsLabel} — ${formatOrderTimestamp(order.created_at)}</p>
      ${hasTracking ? `<p class="order-tracking-line">${[order.carrier, order.tracking_number].filter(Boolean).join(" · ")}</p>` : ""}
      <button type="button" class="order-manage-btn">Update shipment</button>
    </div>
    <div class="order-side">
      <p class="order-amount">${formatNaira(order.total)}</p>
      <span class="status-pill ${slug}">${VENDOR_ORDER_STATUS_LABEL[order.status] || order.status}</span>
    </div>
  `;
  return row;
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
  await loadAndRenderVendorOrders();
  wireOrderFilterTabs();
});
