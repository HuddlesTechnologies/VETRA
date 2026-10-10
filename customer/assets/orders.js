/* =========================================================
   VETRA: Customer orders and tracking page (real backend).
   Renders real order history from GET /api/orders/mine (assets/
   products.js's sibling, see backend/src/routes/orders.routes.js),
   replacing the static mock order cards. Same accordion and status
   filter tabs behavior as before, now wired to real data.

   order.status is stored with underscores (out_for_delivery) but the
   existing CSS/tab markup uses hyphens (status-pill.out-for-delivery,
   data-filter="out-for-delivery"). orderStatusSlug() (api-client.js)
   is the one place that conversion happens. ORDER_STATUS_LABEL is
   also shared from there, same reasoning.

   Expanding a card loads its delivery panel from GET /api/delivery/
   orders/:id (backend/src/routes/delivery.routes.js): the buyer's
   delivery/pickup code, the rider's name and phone, their live
   position on a map, and the delivery event timeline. Open panels for
   orders in motion refresh every 30 seconds.

   Paystack sends the buyer back here as orders.html?payment=<reference>
   after checkout. handlePaymentReturn() polls GET /api/payments/<ref>
   (which confirms the payment with Paystack if its webhook hasn't
   arrived yet), empties the cart once it's paid, and says what happened.
   ========================================================= */

const DELIVERY_REFRESH_MS = 30000;
const LIVE_DELIVERY_STATUSES = ["assigned", "accepted", "picked_up", "out_for_delivery"];

// The normal (non-cancelled) progression, in order, used to derive
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
      if (status === "processing") detail += ", payment held in escrow";
      if (status === "completed") {
        detail += order.escrow_status === "released" ? ", escrow released to vendor" : ", payment held until you confirm";
      }
    } else if (isDone) {
      detail = "Confirmed";
    }
    return `<li class="step ${isDone ? "done" : "upcoming"}${isCurrent ? " current" : ""}"><span class="step-dot"></span><div><strong>${label}</strong><span>${detail}</span></div></li>`;
  }).join("");
}

function buildOrderItemsList(items, paidOnline) {
  if (!items.length) return "";
  const rows = items
    .map((i) => {
      const isUnavailable = i.status === "unavailable";
      return `
        <div class="order-detail-item${isUnavailable ? " is-unavailable" : ""}">
          <img class="order-detail-item-img" src="${VetraAPI.escapeHtml(i.image || "assets/images/product-placeholder.jpg")}" alt="" />
          <div>
            <p class="order-detail-item-name">${VetraAPI.escapeHtml(i.name || "Item")}</p>
            <p class="order-detail-item-meta">Qty ${i.quantity || 1} &middot; ${formatNaira(i.priceAtPurchase)}</p>
            ${isUnavailable ? `<p class="order-detail-unavailable-tag">No longer available, removed from your order${i.unavailableReason ? ` (${VetraAPI.escapeHtml(i.unavailableReason)})` : ""}. ${paidOnline ? "You've been refunded for it." : "You were not charged for it."}</p>` : ""}
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
    ? items.map((i) => `${VetraAPI.escapeHtml(i.name || "Item")}${i.quantity > 1 ? ` ×${i.quantity}` : ""}${i.status === "unavailable" ? " (unavailable)" : ""}`).join(", ")
    : "Order";
  // The order's public ID, the same one the vendor and every email show.
  const shortId = formatOrderRef(order);
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
      <img class="order-thumb" src="${VetraAPI.escapeHtml(image)}" alt="" />
      <div class="order-card-info">
        <p class="order-id">${shortId}</p>
        <p class="order-meta">${itemsLabel} &middot; ${order.vendor_name || ""} ${verifiedBadgeMarkup(order.vendor_kyc_verified)}</p>
        <p class="order-date">Placed ${formatOrderDate(order.created_at)}</p>
        ${order.tracking_number ? `<p class="order-tracking-line">${order.carrier || "Courier"} &middot; ${order.tracking_number}</p>` : ""}
      </div>
      <div class="order-card-side">
        <p class="order-amount">${formatNaira(order.total + (order.delivery_fee || 0))}</p>
        <span class="status-pill ${slug}">${ORDER_STATUS_LABEL[order.status] || order.status}</span>
      </div>
      <svg class="order-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </button>
    <div class="order-track-panel">
      <ol class="order-track-steps">${buildTrackingSteps(order)}</ol>
      <div class="delivery-panel-slot"></div>
      ${buildOrderItemsList(items, Boolean(order.payment_id))}
      ${order.delivery_fee ? `<p class="order-detail-item-meta" style="margin: 0 16px 10px;">Includes ${formatNaira(order.delivery_fee)} delivery</p>` : ""}
      ${order.refunded_amount > 0 ? `<p class="order-refund-line">${formatNaira(order.refunded_amount)} refunded to your card. Banks usually take 5 to 10 working days to show it.</p>` : ""}
      <div class="order-track-actions">
        <button class="secondary-btn order-confirm-btn" type="button" data-action="confirm-received" hidden>I received it, all good</button>
        <button class="secondary-btn" type="button" data-action="report-issue">Report an issue</button>
      </div>
    </div>
  `;
  return div;
}

function buildDeliveryPanel(info) {
  const d = info.delivery;
  const parts = [];

  if (info.deliveryCode) {
    const pickup = info.deliveryMethod === "pickup";
    parts.push(`
      <div class="delivery-code-box">
        <p><strong>${pickup ? "Pickup code" : "Delivery code"}</strong><br/>${pickup
          ? "Show this at the store when you collect."
          : "Give it to the rider only once the package is in your hands."}</p>
        <span class="delivery-code-value">${VetraAPI.escapeHtml(info.deliveryCode)}</span>
      </div>`);
  }
  if (info.codeLocked) {
    parts.push(`<p class="delivery-alert">Too many wrong codes were entered for this order, so it's locked. Contact VETRA support to unlock it.</p>`);
  }

  if (d) {
    const label = d.mode === "self" && !["delivered", "cancelled"].includes(d.status)
      ? "Vendor is shipping with their own courier"
      : DELIVERY_STATUS_LABEL[d.status] || d.status;
    parts.push(`<p class="delivery-panel-heading">${VetraAPI.escapeHtml(label)}</p>`);

    if (d.rider) {
      const vehicle = [RIDER_VEHICLE_LABEL[d.rider.vehicle], d.rider.plate].filter(Boolean).join(" · ");
      parts.push(`
        <div class="delivery-rider-card">
          <div><strong>${VetraAPI.escapeHtml(d.rider.name)}</strong><span>VETRA rider${vehicle ? ` &middot; ${VetraAPI.escapeHtml(vehicle)}` : ""}</span></div>
          ${d.rider.phone ? `<a class="delivery-call-btn" href="tel:${encodeURIComponent(d.rider.phone)}">Call</a>` : ""}
        </div>`);
    }
    if (d.location) {
      parts.push(`<div>${riderMapEmbedMarkup(d.location)}<p class="delivery-map-caption">Rider's position, updated ${formatRelativeTimeNG(d.location.at)}</p></div>`);
    }
    if (d.failedAttempts > 0 && !["delivered", "returned", "cancelled"].includes(d.status)) {
      parts.push(`<p class="delivery-alert">${d.failedAttempts} delivery attempt${d.failedAttempts === 1 ? "" : "s"} missed${d.lastFailureReason ? ` (${VetraAPI.escapeHtml(d.lastFailureReason)})` : ""}. Keep your phone on so the rider can reach you.</p>`);
    }
    if (d.events?.length) {
      parts.push(`<ul class="delivery-events">${d.events
        .slice()
        .reverse()
        .map((e) => `<li><span>${VetraAPI.escapeHtml(e.note || e.event)}</span><time>${formatOrderDate(e.created_at)}</time></li>`)
        .join("")}</ul>`);
    }
  }

  if (info.canConfirm && info.confirmDeadline) {
    parts.push(`<p class="delivery-map-caption">Payment is held in escrow. It releases to the vendor when you confirm, or automatically on ${formatOrderDate(info.confirmDeadline)} unless you report a problem first.</p>`);
  }
  return `<div class="delivery-panel">${parts.join("")}</div>`;
}

async function loadDeliveryPanel(card) {
  const slot = card.querySelector(".delivery-panel-slot");
  if (!slot) return;
  try {
    const info = await VetraAPI.request(`/delivery/orders/${card.dataset.fullOrderId}`, { role: "buyer" });
    slot.innerHTML = buildDeliveryPanel(info);
    card.querySelector('[data-action="confirm-received"]').hidden = !info.canConfirm;
    card.dataset.deliveryLive = info.delivery && LIVE_DELIVERY_STATUSES.includes(info.delivery.status) ? "1" : "";
  } catch (err) {
    slot.innerHTML = "";
  }
}

// Keeps open, in-motion orders fresh (rider position, status changes)
// without a page reload. Polling, not a socket: nothing in this
// backend pushes, see BACKEND_GUIDE.md §2.
function startDeliveryRefresh() {
  setInterval(() => {
    if (document.hidden) return;
    document.querySelectorAll(".order-card.open").forEach((card) => {
      if (card.dataset.deliveryLive) loadDeliveryPanel(card);
    });
  }, DELIVERY_REFRESH_MS);
}

function wireConfirmReceived() {
  const list = document.getElementById("order-list");
  if (!list) return;
  list.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="confirm-received"]');
    if (!btn) return;
    const card = btn.closest(".order-card");
    CustomerUI.confirm({
      title: "Confirm you received it",
      bodyHtml: "This releases your payment to the vendor. Only confirm if everything arrived as described, you can't report an issue against escrow afterwards.",
      confirmLabel: "Yes, release payment",
      onConfirm: async () => {
        try {
          await VetraAPI.request(`/delivery/orders/${card.dataset.fullOrderId}/confirm`, { method: "POST", role: "buyer" });
          btn.hidden = true;
          await loadDeliveryPanel(card);
          CustomerUI.info({ title: "Thanks for confirming", bodyHtml: "The vendor has been paid. You can still leave them a review from their store page." });
        } catch (err) {
          CustomerUI.info({ title: "Couldn't confirm", bodyHtml: err.message });
        }
      },
    });
  });
}

async function loadAndRenderOrders() {
  const list = document.getElementById("order-list");
  if (!list) return;

  if (!VetraAPI.getToken("buyer")) {
    list.innerHTML = `<p class="products-empty-state">Sign in to view your order history.</p>`;
    CustomerUI.confirm({
      title: "Sign in required",
      bodyHtml: "You need an account to view your order history.",
      confirmLabel: "Sign in",
      onConfirm: () => {
        window.location.href = "../signin.html";
      },
      onCancel: () => {
        window.location.href = "dashboard.html";
      },
    });
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
    if (isOpen) loadDeliveryPanel(card);
  });
}

// ---------- Returning from Paystack ----------

const PAYMENT_POLL_MS = 3000;
const PAYMENT_POLL_LIMIT = 20; // about a minute

function forgetPaidCart() {
  // cart.html's CartStore and checkout key; CartStore itself isn't loaded here.
  try {
    localStorage.removeItem("vetra_customer_cart");
    sessionStorage.removeItem("vetra_checkout_nonce");
  } catch (e) {
    /* storage unavailable, nothing to clear */
  }
  if (typeof Vetra !== "undefined" && Vetra.updateCartBadge) Vetra.updateCartBadge();
}

async function handlePaymentReturn() {
  const reference = new URLSearchParams(window.location.search).get("payment");
  if (!reference || !VetraAPI.getToken("buyer")) return false;
  // Drop the parameter so a refresh doesn't replay this.
  history.replaceState(null, "", window.location.pathname);

  const banner = document.createElement("p");
  banner.className = "payment-return-banner";
  banner.textContent = "Confirming your payment with Paystack…";
  document.getElementById("order-list")?.before(banner);

  let result = null;
  for (let attempt = 0; attempt < PAYMENT_POLL_LIMIT; attempt += 1) {
    try {
      result = await VetraAPI.request(`/payments/${encodeURIComponent(reference)}`, { method: "GET", role: "buyer" });
    } catch (err) {
      if (err.status === 404) break;
    }
    if (result && result.status !== "initialized") break;
    await new Promise((resolve) => setTimeout(resolve, PAYMENT_POLL_MS));
  }
  banner.remove();

  if (result?.status === "success") {
    forgetPaidCart();
    const codes = result.orders.map((o) => `<strong>${VetraAPI.escapeHtml(o.trackingCode)}</strong>`).join(", ");
    CustomerUI.info({
      title: "Payment received",
      bodyHtml: `Thanks, your order${result.orders.length > 1 ? "s are" : " is"} confirmed: ${codes}.${result.orders.length > 1 ? " Your cart had items from more than one store, so each store sends its part separately." : ""} Your delivery or pickup code is on each order below. Only give it to the rider once you have the package.`,
    });
    return true;
  }
  if (result?.refunded) {
    CustomerUI.info({
      title: "Payment refunded",
      bodyHtml: "Your payment arrived after the checkout had expired, so we couldn't hold your items. It's being refunded to your card in full.",
    });
    return true;
  }
  if (result?.status === "initialized") {
    CustomerUI.info({
      title: "Still confirming",
      bodyHtml: "Paystack hasn't confirmed your payment yet. If you were charged, your order will appear here shortly and we'll email you. Your cart is saved until then.",
    });
    return true;
  }
  CustomerUI.confirm({
    title: "Payment not completed",
    bodyHtml: "Your payment didn't go through, so no order was placed. Your cart is still saved.",
    confirmLabel: "Back to cart",
    onConfirm: () => {
      window.location.href = "cart.html";
    },
  });
  return true;
}

document.addEventListener("DOMContentLoaded", async () => {
  await handlePaymentReturn();
  await loadAndRenderOrders();
  wireOrderFilterTabs();
  wireOrderExpand();
  wireConfirmReceived();
  startDeliveryRefresh();
});
