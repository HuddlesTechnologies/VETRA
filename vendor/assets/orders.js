/* =========================================================
   VETRA: Vendor orders page (real backend).
   Renders real orders from GET /api/orders/vendor (assets/
   order-tracking.js's sibling, see backend/src/routes/orders.routes.js),
   replacing the static mock rows. Same status filter tabs and
   "Show more" capping behavior as before, now wired to real data.

   Status is stored with underscores (out_for_delivery) but the
   existing CSS/tab markup uses hyphens (status-pill.out-for-delivery,
   data-filter="out-for-delivery"). orderStatusSlug() (api-client.js)
   is the one place that conversion happens; order-tracking.js
   converts back the other way before it PATCHes. ORDER_STATUS_LABEL
   is also shared from there.

   Delivery (backend/src/utils/delivery.js): orders placed since the
   delivery system went live are delivered by a VETRA rider by default,
   so the row shows delivery actions instead of the free-form "Update
   shipment" modal: mark it ready for pickup, read the 4-digit pickup
   code to the rider, or switch to shipping it yourself. Pickup orders
   complete when the buyer's code is typed in. "Update shipment" stays
   for self-shipped orders and orders placed before this existed.
   ========================================================= */

const ORDERS_MAX_VISIBLE = 5;

const PACKAGE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>`;

// formatOrderTimestamp: shared from assets/interactions.js (both this
// page and dashboard.html load it).

// The expand panel's contents: itemized products (name/qty/price/
// image) plus the customer's contact details (name, phone, delivery
// address), so a vendor can see exactly what was ordered and who to
// reach without leaving the orders list. buyer_phone/delivery_address
// come from GET /api/orders/vendor (see backend/src/routes/
// orders.routes.js), a signed-in buyer's account phone or a guest's
// own phone, and this specific order's delivery address.
function buildOrderDetailPanel(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  // "Mark unavailable" only makes sense before a shipment physically
  // goes out, matches the same guard the backend enforces (PATCH
  // /:id/items/:itemId/unavailable rejects it once status has moved
  // past processing), so the button doesn't dangle uselessly for an
  // order that would just reject the click.
  const canMarkUnavailable = ["pending", "processing"].includes(order.status);
  const itemsHtml = items.length
    ? items
        .map((i) => {
          const isUnavailable = i.status === "unavailable";
          return `
        <div class="order-detail-item${isUnavailable ? " is-unavailable" : ""}" data-item-id="${i.id}">
          <img class="order-detail-item-img" src="${VetraAPI.escapeHtml(i.image || "assets/images/product-placeholder.jpg")}" alt="" />
          <div>
            <p class="order-detail-item-name">${VetraAPI.escapeHtml(i.name || "Item")}</p>
            <p class="order-detail-item-meta">Qty ${i.quantity || 1} &middot; ${formatNaira(i.priceAtPurchase)}</p>
            ${isUnavailable ? `<p class="order-detail-unavailable-tag">Marked unavailable${i.unavailableReason ? `, ${VetraAPI.escapeHtml(i.unavailableReason)}` : ""}</p>` : ""}
          </div>
          ${!isUnavailable && canMarkUnavailable ? `<button type="button" class="order-item-unavailable-btn" data-item-id="${i.id}">Mark unavailable</button>` : ""}
        </div>`;
        })
        .join("")
    : `<p class="order-detail-empty">No item details available.</p>`;

  const customerRows = [
    ["Name", order.buyer_name || "Guest"],
    ["Phone", order.buyer_phone || "—"],
    ["Delivery", order.delivery_method === "pickup" ? "Collecting from your store" : [order.delivery_address, order.delivery_state].filter(Boolean).join(", ") || "—"],
    ...(order.delivery_notes ? [["Directions", order.delivery_notes]] : []),
  ]
    .map(([label, value]) => `<p class="order-detail-customer-row"><span>${label}</span>${VetraAPI.escapeHtml(value)}</p>`)
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

// Which controls a row gets, keyed off who is moving the parcel.
function buildDeliveryBox(order) {
  const legacy = !order.has_delivery_code;
  const isPickup = order.delivery_method === "pickup";
  const selfShip = order.delivery_mode === "self";
  const open = ["pending", "processing"].includes(order.status);
  if (legacy || selfShip) return "";

  const btn = (action, label, extra = "") => `<button type="button" class="order-delivery-btn${extra}" data-delivery-action="${action}">${label}</button>`;
  const lines = [];
  const actions = [];

  if (isPickup) {
    if (!open) return "";
    lines.push(`<span class="order-delivery-status">Buyer collects from your store</span>`);
    if (order.status === "pending") actions.push(btn("accept", "Accept order"));
    return `
      <div class="order-delivery-box" data-order-id="${order.id}">
        ${lines.join("")}
        <form class="order-code-form" data-delivery-action="pickup-complete">
          <input type="text" inputmode="numeric" maxlength="6" placeholder="Buyer's 6-digit code" aria-label="Buyer's pickup code" />
          <button type="submit" class="order-delivery-btn primary">Confirm pickup</button>
        </form>
        <div class="order-delivery-actions">${actions.join("")}${btn("cancel", "Cancel order", " danger")}</div>
      </div>`;
  }

  const ds = order.delivery_status;
  const riderLine = order.rider_name
    ? `${VetraAPI.escapeHtml(order.rider_name)}${order.rider_phone ? ` &middot; <a href="tel:${encodeURIComponent(order.rider_phone)}">${VetraAPI.escapeHtml(order.rider_phone)}</a>` : ""}${order.rider_plate ? ` &middot; ${VetraAPI.escapeHtml(order.rider_plate)}` : ""}`
    : "";

  lines.push(`<span class="order-delivery-status">${DELIVERY_STATUS_LABEL[ds] || ds}</span>`);
  if (ds === "awaiting_vendor") {
    actions.push(btn("ready", "Packed, ready for pickup", " primary"), btn("self-ship", "I'll ship it myself"), btn("cancel", "Cancel order", " danger"));
  } else if (ds === "ready" || ds === "assigned") {
    lines.push(`<span class="order-delivery-sub">VETRA is matching a rider in your area.</span>`);
    actions.push(btn("self-ship", "I'll ship it myself"), btn("cancel", "Cancel order", " danger"));
  } else if (ds === "accepted") {
    lines.push(`<span class="order-delivery-sub">Collecting: ${riderLine}</span>`);
    lines.push(`<span class="order-pickup-code">Pickup code <strong>${VetraAPI.escapeHtml(order.pickup_code || "")}</strong> &middot; read it to the rider when you hand over</span>`);
    actions.push(btn("cancel", "Cancel order", " danger"));
  } else if (ds === "picked_up" || ds === "out_for_delivery") {
    lines.push(`<span class="order-delivery-sub">With ${riderLine || "the rider"}</span>`);
  } else if (ds === "returning") {
    lines.push(`<span class="order-delivery-sub">Couldn't be delivered${order.delivery_failure_reason ? `: ${VetraAPI.escapeHtml(order.delivery_failure_reason)}` : ""}. ${riderLine ? `${riderLine} is bringing it back.` : ""}</span>`);
    actions.push(btn("return-received", "I've got it back", " primary"));
  } else {
    return "";
  }
  return `
    <div class="order-delivery-box" data-order-id="${order.id}">
      ${lines.join("")}
      ${actions.length ? `<div class="order-delivery-actions">${actions.join("")}</div>` : ""}
    </div>`;
}

function buildVendorOrderRow(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsLabel = items.length
    ? items.map((i) => `${VetraAPI.escapeHtml(i.name || "Item")}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ")
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
      <p class="order-id">${formatOrderRef(order)} &middot; ${VetraAPI.escapeHtml(order.buyer_name || "Guest")}</p>
      <p class="order-meta">${itemsLabel}, ${formatOrderTimestamp(order.created_at)}</p>
      ${hasTracking ? `<p class="order-tracking-line">${[order.carrier, order.tracking_number].filter(Boolean).join(" · ")}</p>` : ""}
      ${buildDeliveryBox(order)}
      ${!order.has_delivery_code || order.delivery_mode === "self" ? `<button type="button" class="order-manage-btn">Update shipment</button>` : ""}
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
// row's detail panel, product line items plus customer contact info.
// Delegated on the list so it keeps working after loadAndRenderVendorOrders()
// re-renders rows or order-tracking.js patches one in place.
function wireOrderRowExpand(list) {
  list.addEventListener("click", (e) => {
    if (e.target.closest(".order-manage-btn, .order-item-unavailable-btn, .order-delivery-box")) return;
    const row = e.target.closest(".order-item");
    if (!row) return;
    const panel = row.querySelector(".order-detail-panel");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    row.classList.toggle("expanded", !panel.hidden);
  });
}

// "Mark unavailable": PATCH /orders/:id/items/:itemId/unavailable
// (see backend/src/routes/orders.routes.js). A simple confirm rather
// than a reason-input modal (VendorUI.confirm has no text-field mode,
// unlike AdminUI.confirm's showReason), reason stays optional and
// this keeps the action to one click plus a confirm, matching how
// Update Shipment's own confirm-free flow reads.
function wireMarkUnavailableButtons(list) {
  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".order-item-unavailable-btn");
    if (!btn) return;
    e.preventDefault();

    const row = btn.closest(".order-item");
    const itemNameEl = btn.closest(".order-detail-item")?.querySelector(".order-detail-item-name");
    const itemName = itemNameEl ? itemNameEl.textContent : "this item";
    const orderId = row?.dataset.orderId;
    const itemId = btn.dataset.itemId;
    if (!orderId || !itemId) return;

    VendorUI.confirm({
      title: "Mark item unavailable",
      bodyHtml: `Mark <span class="confirm-modal-target">${VetraAPI.escapeHtml(itemName)}</span> as unavailable? The buyer will be notified and the order total will be adjusted. This can't be undone.`,
      confirmLabel: "Mark unavailable",
      danger: true,
      onConfirm: async () => {
        try {
          await VetraAPI.request(`/orders/${orderId}/items/${itemId}/unavailable`, {
            method: "PATCH",
            role: "vendor",
          });
          await loadAndRenderVendorOrders();
          if (window.VetraVendorOrderFilters) window.VetraVendorOrderFilters.applyVisibility();
        } catch (err) {
          VendorUI.info({ title: "Couldn't update item", bodyHtml: err.message });
        }
      },
    });
  });
}

const DELIVERY_ACTIONS = {
  ready: {
    title: "Ready for pickup?",
    body: "Only confirm once it's packed and labelled. VETRA will send the nearest available rider, and you'll see their name and your pickup code here.",
    confirmLabel: "It's ready",
    run: (id) => VetraAPI.request(`/delivery/orders/${id}/ready`, { method: "POST", role: "vendor" }),
    done: (r) => (r && r.riderAssigned ? "A rider has been offered the job. Their name appears here once they accept." : "It's in the dispatch queue, a rider will be assigned shortly."),
  },
  "self-ship": {
    title: "Ship it yourself?",
    body: "You'll arrange delivery with your own courier and update the status with \"Update shipment\". The buyer still confirms receipt before your funds release.",
    confirmLabel: "I'll ship it",
    run: (id) => VetraAPI.request(`/delivery/orders/${id}/self-ship`, { method: "POST", role: "vendor" }),
  },
  accept: {
    title: "Accept this order?",
    body: "The buyer will be told their order is being prepared.",
    confirmLabel: "Accept",
    run: (id) => VetraAPI.request(`/orders/${id}/shipment`, { method: "PATCH", role: "vendor", body: { status: "processing" } }),
  },
  cancel: {
    title: "Cancel this order?",
    body: "The buyer is notified and won't be charged. This can't be undone.",
    confirmLabel: "Cancel order",
    danger: true,
    run: (id) => VetraAPI.request(`/orders/${id}/shipment`, { method: "PATCH", role: "vendor", body: { status: "cancelled" } }),
  },
  "return-received": {
    title: "Got the parcel back?",
    body: "Confirming cancels the order and puts the items back into your stock.",
    confirmLabel: "Yes, it's back",
    run: (id) => VetraAPI.request(`/delivery/orders/${id}/return-received`, { method: "POST", role: "vendor" }),
  },
};

async function refreshVendorOrders() {
  await loadAndRenderVendorOrders();
  if (window.VetraVendorOrderFilters) window.VetraVendorOrderFilters.applyVisibility();
}

function wireDeliveryActions(list) {
  list.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-delivery-action]");
    if (!btn) return;
    const action = DELIVERY_ACTIONS[btn.dataset.deliveryAction];
    const orderId = btn.closest(".order-delivery-box")?.dataset.orderId;
    if (!action || !orderId) return;
    VendorUI.confirm({
      title: action.title,
      bodyHtml: action.body,
      confirmLabel: action.confirmLabel,
      danger: !!action.danger,
      onConfirm: async () => {
        try {
          const result = await action.run(orderId);
          await refreshVendorOrders();
          if (action.done) VendorUI.info({ title: "Done", bodyHtml: action.done(result) });
        } catch (err) {
          VendorUI.info({ title: "Couldn't update order", bodyHtml: err.message });
        }
      },
    });
  });

  // Pickup handover: the buyer reads their code, the vendor types it.
  list.addEventListener("submit", async (e) => {
    const form = e.target.closest(".order-code-form");
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector("input");
    const orderId = form.closest(".order-delivery-box")?.dataset.orderId;
    const code = input.value.trim();
    if (!/^\d{6}$/.test(code)) {
      VendorUI.info({ title: "Check the code", bodyHtml: "Pickup codes are 6 digits, shown on the buyer's Orders page." });
      return;
    }
    const submit = form.querySelector("button");
    submit.disabled = true;
    try {
      await VetraAPI.request(`/delivery/orders/${orderId}/pickup-complete`, { method: "POST", role: "vendor", body: { code } });
      await refreshVendorOrders();
      VendorUI.info({ title: "Handed over", bodyHtml: "Order marked collected. Funds release once the buyer confirms, or automatically after the protection window." });
    } catch (err) {
      VendorUI.info({ title: "Couldn't confirm pickup", bodyHtml: err.message });
      submit.disabled = false;
    }
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
  if (list) {
    wireOrderRowExpand(list);
    wireMarkUnavailableButtons(list);
    wireDeliveryActions(list);
  }
});
