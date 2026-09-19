/* =========================================================
   VETRA — CUSTOMER ORDERS & TRACKING PAGE (real backend)
   Renders real order history from GET /api/orders/mine (assets/
   products.js's sibling — see backend/src/routes/orders.routes.js),
   replacing the static mock order cards. Same accordion + status-
   filter-tabs behavior as before, now wired to real data.

   order.status is stored with underscores (out_for_delivery) but the
   existing CSS/tab markup uses hyphens (status-pill.out-for-delivery,
   data-filter="out-for-delivery") — orderStatusSlug() (api-client.js)
   is the one place that conversion happens. ORDER_STATUS_LABEL is
   also shared from there, same reasoning.
   ========================================================= */

// The normal (non-cancelled) progression, in order — used to derive
// each timeline step's done/current/upcoming state from the order's
// current status.
const PROGRESS_STATUSES = ["pending", "processing", "shipped", "out_for_delivery", "completed"];
const STEP_LABELS = {
  pending: "Order placed",
  processing: "Processing",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  completed: "Delivered",
};
const STEP_TIMESTAMP_FIELD = {
  shipped: "shipped_at",
  out_for_delivery: "out_for_delivery_at",
  completed: "delivered_at",
};

function formatOrderDate(iso) {
  return formatDateTimeNG(iso, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function buildTrackingSteps(order) {
  if (order.status === "cancelled") {
    return `
      <li class="step done"><span class="step-dot"></span><div><strong>Order placed</strong><span>${formatOrderDate(order.created_at)}</span></div></li>
      <li class="step done current"><span class="step-dot"></span><div><strong>Cancelled</strong><span>${formatOrderDate(order.cancelled_at)}</span></div></li>
    `;
  }

  const currentIndex = PROGRESS_STATUSES.indexOf(order.status);
  return PROGRESS_STATUSES.map((status, i) => {
    const isDone = i <= currentIndex;
    const isCurrent = i === currentIndex;
    const label = STEP_LABELS[status];
    const tsField = STEP_TIMESTAMP_FIELD[status];
    let detail = "Pending";
    if (status === "pending") {
      detail = formatOrderDate(order.created_at);
    } else if (isDone && tsField && order[tsField]) {
      detail = formatOrderDate(order[tsField]);
      if (status === "processing") detail += " — payment held in escrow";
      if (status === "completed") detail += " — escrow released to vendor";
    } else if (isDone) {
      detail = "Confirmed";
    }
    return `<li class="step ${isDone ? "done" : "upcoming"}${isCurrent ? " current" : ""}"><span class="step-dot"></span><div><strong>${label}</strong><span>${detail}</span></div></li>`;
  }).join("");
}

function buildOrderItemsList(items) {
  if (!items.length) return "";
  const rows = items
    .map((i) => {
      const isUnavailable = i.status === "unavailable";
      return `
        <div class="order-detail-item${isUnavailable ? " is-unavailable" : ""}">
          <img class="order-detail-item-img" src="${i.image || "assets/images/product-placeholder.jpg"}" alt="" />
          <div>
            <p class="order-detail-item-name">${VetraAPI.escapeHtml(i.name || "Item")}</p>
            <p class="order-detail-item-meta">Qty ${i.quantity || 1} &middot; ${formatNaira(i.priceAtPurchase)}</p>
            ${isUnavailable ? `<p class="order-detail-unavailable-tag">No longer available — removed from your order${i.unavailableReason ? ` (${VetraAPI.escapeHtml(i.unavailableReason)})` : ""}. You were not charged for it.</p>` : ""}
          </div>
        </div>`;
    })
    .join("");
  return `<div class="order-detail-items">${rows}</div>`;
}

function buildOrderCard(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const firstItem = items[0];
  const image = (firstItem && firstItem.image) || "assets/images/product-placeholder.jpg";
  const itemsLabel = items.length
    ? items.map((i) => `${i.name || "Item"}${i.quantity > 1 ? ` ×${i.quantity}` : ""}${i.status === "unavailable" ? " (unavailable)" : ""}`).join(", ")
    : "Order";
  // The customer's own tracking ID (order.tracking_code, "VTA..." — see
  // backend/src/utils/id.js's newTrackingCode()) — a distinct value
  // from the order's own id, not that id reformatted. Falls back to the
  // VTR-style reference for any order placed before this field existed.
  const shortId = order.tracking_code || formatOrderRef(order.id);
  const slug = orderStatusSlug(order.status);

  const div = document.createElement("div");
  div.className = "order-card";
  div.dataset.status = slug;
  div.dataset.orderId = shortId;
  div.dataset.fullOrderId = order.id;
  div.dataset.vendorId = order.vendor_id;
  div.dataset.vendorName = order.vendor_name || "";

  div.innerHTML = `
    <button type="button" class="order-card-summary" aria-expanded="false">
      <img class="order-thumb" src="${image}" alt="" />
      <div class="order-card-info">
        <p class="order-id">${shortId}</p>
        <p class="order-meta">${itemsLabel} &middot; ${order.vendor_name || ""} ${verifiedBadgeMarkup(order.vendor_kyc_verified)}</p>
        <p class="order-date">Placed ${formatOrderDate(order.created_at)}</p>
        ${order.tracking_number ? `<p class="order-tracking-line">${order.carrier || "Courier"} &middot; ${order.tracking_number}</p>` : ""}
      </div>
      <div class="order-card-side">
        <p class="order-amount">${formatNaira(order.total)}</p>
        <span class="status-pill ${slug}">${ORDER_STATUS_LABEL[order.status] || order.status}</span>
      </div>
      <svg class="order-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </button>
    <div class="order-track-panel">
      <ol class="order-track-steps">${buildTrackingSteps(order)}</ol>
      ${buildOrderItemsList(items)}
      <div class="order-track-actions">
        <button class="secondary-btn" type="button" data-action="report-issue">Report an issue</button>
      </div>
    </div>
  `;
  return div;
}

async function loadAndRenderOrders() {
  const list = document.getElementById("order-list");
  if (!list) return;

  if (!VetraAPI.getToken("buyer")) {
    window.location.href = "../signin.html";
    return;
  }

  list.innerHTML = `<p class="products-empty-state">Loading your orders…</p>`;
  try {
    const orders = await VetraAPI.request("/orders/mine", { method: "GET", role: "buyer" });
    if (!orders.length) {
      list.innerHTML = `<p class="products-empty-state">You haven't placed any orders yet.</p>`;
      return;
    }
    list.innerHTML = "";
    orders.forEach((o) => list.appendChild(buildOrderCard(o)));
  } catch (err) {
    list.innerHTML = `<p class="products-empty-state">Couldn't load your orders: ${err.message}</p>`;
  }
}

function wireOrderFilterTabs() {
  const tabs = document.getElementById("order-filter-tabs");
  const list = document.getElementById("order-list");
  if (!tabs || !list) return;

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tab");
    if (!btn) return;

    tabs.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    const filter = btn.dataset.filter;
    list.querySelectorAll(".order-card").forEach((card) => {
      const show = filter === "all" || card.dataset.status === filter;
      card.style.display = show ? "" : "none";
    });
  });
}

function wireOrderExpand() {
  const list = document.getElementById("order-list");
  if (!list) return;

  list.addEventListener("click", (e) => {
    const summary = e.target.closest(".order-card-summary");
    if (!summary) return;
    const card = summary.closest(".order-card");
    if (!card) return;

    const isOpen = card.classList.toggle("open");
    summary.setAttribute("aria-expanded", String(isOpen));
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadAndRenderOrders();
  wireOrderFilterTabs();
  wireOrderExpand();
});
