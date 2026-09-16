/* =========================================================
   VETRA — CART PAGE (customer/cart.html)
   Renders real cart contents from CartStore (assets/cart-store.js),
   backed by the real catalog (assets/products.js) — every product in
   the cart is preloaded from GET /api/products/:id before rendering,
   since CartStore.getItems() only resolves what's already cached.

   Checkout calls the real POST /api/orders — see
   backend/src/routes/orders.routes.js. That route is single-vendor
   per order, but this cart can hold items from several vendors at
   once, so checkout groups cart lines by vendor_id and submits one
   order per vendor group, the same way a real multi-vendor
   marketplace splits a mixed cart at payment time.

   formatNaira/nairaToKobo come from api-client.js — every price here
   (product.price, DELIVERY_FEE_KOBO) is kobo throughout; formatting
   for display is the only place a naira number ever appears.
   ========================================================= */

const DELIVERY_FEE_KOBO = 150000; // ₦1,500 flat fee, matches the previous mock checkout

function renderCart() {
  const items = CartStore.getItems();
  const emptyState = document.getElementById("cart-empty-state");
  const content = document.getElementById("cart-content");

  if (!items.length) {
    emptyState.hidden = false;
    content.hidden = true;
    return;
  }
  emptyState.hidden = true;
  content.hidden = false;

  const list = document.getElementById("cart-items-list");
  list.innerHTML = items
    .map(({ id, qty, product }) => {
      const images = Array.isArray(product.images) ? product.images : [];
      const image = images[0] || "assets/images/product-placeholder.jpg";
      const vendorLink = product.vendor_id
        ? `<a class="contact-vendor-btn" href="store.html?vendor=${product.vendor_id}" style="text-decoration:none; display:inline-block;">Visit store</a>`
        : "";
      return `
        <div class="cart-item" data-product-id="${id}">
          <div class="cart-item-main">
            <a class="cart-thumb" href="product.html?id=${id}" aria-label="View ${product.name}">
              <img src="${image}" alt="${product.name}" />
            </a>
            <div>
              <h3><a href="product.html?id=${id}" style="color: inherit; text-decoration: none;">${product.name}</a></h3>
              <p>${formatNaira(product.price)} each</p>
              ${vendorLink}
              <button class="contact-vendor-btn" type="button" data-action="remove">Remove</button>
            </div>
          </div>
          <div class="cart-item-actions">
            <button class="qty-btn" type="button" data-action="decrement">−</button>
            <span>${qty}</span>
            <button class="qty-btn" type="button" data-action="increment">+</button>
          </div>
          <div class="cart-price">${formatNaira(product.price * qty)}</div>
        </div>
      `;
    })
    .join("");

  const subtotal = CartStore.getSubtotal();
  const total = subtotal + DELIVERY_FEE_KOBO;
  document.getElementById("cart-subtotal").textContent = formatNaira(subtotal);
  document.getElementById("cart-delivery").textContent = formatNaira(DELIVERY_FEE_KOBO);
  document.getElementById("cart-total").textContent = formatNaira(total);
}

// CartStore.getItems() only resolves ids already in VetraCatalog's cache —
// load every id currently in the cart before the first render.
async function preloadCartProducts() {
  const ids = CartStore.getIds();
  await Promise.all(ids.map((id) => VetraCatalog.loadOne(id).catch(() => null)));
}

function wireCartItemActions() {
  document.getElementById("cart-items-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const row = btn.closest("[data-product-id]");
    const id = row.dataset.productId;
    const current = CartStore.getItems().find((i) => i.id === id);
    if (!current) return;

    if (btn.dataset.action === "increment") {
      CartStore.setQty(id, current.qty + 1);
    } else if (btn.dataset.action === "decrement") {
      CartStore.setQty(id, current.qty - 1); // setQty removes the line once qty hits 0
    } else if (btn.dataset.action === "remove") {
      CartStore.removeItem(id);
    }

    renderCart();
    if (typeof Vetra !== "undefined") Vetra.updateCartBadge();
  });
}

function wireSaveForLaterButton() {
  const btn = document.getElementById("cart-save-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // TODO: replace with a real save-for-later API call.
    CustomerUI.info({ title: "Cart saved for later", bodyHtml: "Hook this up to your save-for-later API." });
  });
}

// One key per checkout attempt, not per click — reused across a retry of
// the *same* attempt (a stalled network, a second click before the first
// request lands) so the server recognizes it as a replay instead of a new
// order (see backend/src/routes/orders.routes.js's idempotencyKey check).
// Cleared once checkout actually succeeds, or if the cart's contents
// change, so a genuinely new checkout gets a fresh key. Survives a page
// reload (sessionStorage, not a plain variable) since a reload after a
// stalled response is the most likely real-world retry.
const CHECKOUT_NONCE_KEY = "vetra_checkout_nonce";

function getCheckoutNonce() {
  try {
    let nonce = sessionStorage.getItem(CHECKOUT_NONCE_KEY);
    if (!nonce) {
      nonce = crypto.randomUUID();
      sessionStorage.setItem(CHECKOUT_NONCE_KEY, nonce);
    }
    return nonce;
  } catch (e) {
    return crypto.randomUUID(); // sessionStorage unavailable — still usable for this one attempt
  }
}

function clearCheckoutNonce() {
  try {
    sessionStorage.removeItem(CHECKOUT_NONCE_KEY);
  } catch (e) {
    /* ignore */
  }
}

function groupByVendor(items) {
  const groups = {};
  items.forEach((item) => {
    const vendorId = item.product.vendor_id;
    if (!groups[vendorId]) groups[vendorId] = [];
    groups[vendorId].push(item);
  });
  return groups;
}

function wireCheckoutButton() {
  const btn = document.getElementById("cart-checkout-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const items = CartStore.getItems();
    if (!items.length) return;

    // Guest checkout needs a name/email/phone form this page doesn't have
    // yet — gate to a real signed-in buyer for now rather than fabricating
    // guest details. See BACKEND_GUIDE.md's guest-checkout note.
    if (!VetraAPI.getToken("buyer")) {
      window.location.href = "../signin.html";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Processing…";

    try {
      const me = await VetraAPI.request("/auth/me", { method: "GET", role: "buyer" }).catch(() => null);
      const groups = groupByVendor(items);
      const nonce = getCheckoutNonce();

      for (const vendorId of Object.keys(groups)) {
        const groupItems = groups[vendorId];
        await VetraAPI.request("/orders", {
          method: "POST",
          role: "buyer",
          body: {
            vendorId,
            items: groupItems.map((i) => ({ productId: i.id, quantity: i.qty })),
            deliveryMethod: "delivery",
            deliveryAddress: me ? me.address : null,
            // One order per vendor group, so the key has to vary by vendor
            // too — otherwise the second group's real order would look
            // like a replay of the first and get silently dropped.
            idempotencyKey: `${nonce}:${vendorId}`,
          },
        });
      }

      clearCheckoutNonce();
      CartStore.clear();
      if (typeof Vetra !== "undefined") Vetra.updateCartBadge();
      CustomerUI.info({
        title: "Order placed!",
        bodyHtml: Object.keys(groups).length > 1
          ? "Your cart had items from more than one store, so it was split into separate orders — one per vendor."
          : "You can track it from your Orders page.",
        onClose: () => {
          window.location.href = "orders.html";
        },
      });
    } catch (err) {
      CustomerUI.info({ title: "Couldn't place order", bodyHtml: err.message });
      btn.disabled = false;
      btn.textContent = "Checkout";
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await preloadCartProducts();
  renderCart();
  wireCartItemActions();
  wireSaveForLaterButton();
  wireCheckoutButton();
});
