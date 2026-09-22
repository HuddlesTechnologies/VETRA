/* =========================================================
   VETRA: Cart page (customer/cart.html).
   Renders real cart contents from CartStore (assets/cart-store.js),
   backed by the real catalog (assets/products.js). Every product in
   the cart is preloaded from GET /api/products/:id before rendering,
   since CartStore.getItems() only resolves what's already cached.

   Checkout calls the real POST /api/orders, see
   backend/src/routes/orders.routes.js. That route is single-vendor
   per order, but this cart can hold items from several vendors at
   once, so checkout groups cart lines by vendor_id and submits one
   order per vendor group, the same way a real multi-vendor
   marketplace splits a mixed cart at payment time.

   formatNaira/nairaToKobo come from api-client.js, every price here
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
      // Capped at stock_quantity, same reasoning as product.html's own
      // qty stepper, checkout would reject an over-stock order anyway
      // (POST /api/orders), so this just tells the buyer why up front.
      // null/undefined (data unavailable) falls back to no cap, a real
      // 0 must still cap immediately, Number(0) || 0 would otherwise
      // collapse both cases together.
      const stockAvailable = product.stock_quantity == null ? Infinity : Number(product.stock_quantity);
      const atMax = qty >= stockAvailable;
      const outOfStock = stockAvailable <= 0;
      const name = VetraAPI.escapeHtml(product.name || "");
      return `
        <div class="cart-item${outOfStock ? " cart-item-oos" : ""}" data-product-id="${id}" data-out-of-stock="${outOfStock}">
          <div class="cart-item-main">
            <a class="cart-thumb" href="product.html?id=${id}" aria-label="View ${name}">
              <img src="${image}" alt="${name}" />
            </a>
            <div>
              <h3><a href="product.html?id=${id}" style="color: inherit; text-decoration: none;">${name}</a></h3>
              <p>${formatNaira(product.price)} each</p>
              ${vendorLink}
              <button class="contact-vendor-btn" type="button" data-action="remove">Remove</button>
            </div>
          </div>
          <div class="cart-item-col">
            ${outOfStock ? `<p class="qty-stock-hint">Out of stock, remove to continue</p>` : `
            <div class="cart-item-actions">
              <button class="qty-btn" type="button" data-action="decrement">−</button>
              <span>${qty}</span>
              <button class="qty-btn" type="button" data-action="increment" ${atMax ? "disabled" : ""}>+</button>
            </div>
            ${atMax ? `<p class="qty-stock-hint">Only ${stockAvailable} in stock</p>` : ""}
            `}
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

// CartStore.getItems() only resolves ids already in VetraCatalog's cache,
// load every id currently in the cart (and saved-for-later) before the
// first render.
async function preloadCartProducts() {
  const ids = [...CartStore.getIds(), ...SavedForLaterStore.getIds()];
  await Promise.all(ids.map((id) => VetraCatalog.loadOne(id).catch(() => null)));
}

function renderSavedForLater() {
  const items = SavedForLaterStore.getItems();
  const section = document.getElementById("saved-for-later-section");
  if (!section) return;

  if (!items.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const list = document.getElementById("saved-for-later-list");
  list.innerHTML = items
    .map(({ id, qty, product }) => {
      const images = Array.isArray(product.images) ? product.images : [];
      const image = images[0] || "assets/images/product-placeholder.jpg";
      const name = VetraAPI.escapeHtml(product.name || "");
      return `
        <div class="cart-item" data-product-id="${id}" data-qty="${qty}">
          <div class="cart-item-main">
            <a class="cart-thumb" href="product.html?id=${id}" aria-label="View ${name}">
              <img src="${image}" alt="${name}" />
            </a>
            <div>
              <h3><a href="product.html?id=${id}" style="color: inherit; text-decoration: none;">${name}</a></h3>
              <p>${formatNaira(product.price)} each${qty > 1 ? ` &middot; qty ${qty}` : ""}</p>
              <button class="contact-vendor-btn" type="button" data-action="move-to-cart">Move to cart</button>
              <button class="contact-vendor-btn" type="button" data-action="remove-saved">Remove</button>
            </div>
          </div>
          <div class="cart-price">${formatNaira(product.price * qty)}</div>
        </div>
      `;
    })
    .join("");
}

function wireSavedForLaterActions() {
  const list = document.getElementById("saved-for-later-list");
  if (!list) return;
  list.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const row = btn.closest("[data-product-id]");
    const id = row.dataset.productId;
    const qty = Number(row.dataset.qty) || 1;

    if (btn.dataset.action === "move-to-cart") {
      CartStore.addItem(id, qty);
      SavedForLaterStore.removeItem(id);
    } else if (btn.dataset.action === "remove-saved") {
      SavedForLaterStore.removeItem(id);
    }

    renderCart();
    renderSavedForLater();
    if (typeof Vetra !== "undefined") Vetra.updateCartBadge();
  });
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
      const stockAvailable = current.product.stock_quantity == null ? Infinity : Number(current.product.stock_quantity);
      if (current.qty >= stockAvailable) return;
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

// Moves every current cart line into SavedForLaterStore in one click,
// then clears the active cart, matches this button's placement as a
// whole-cart action in the order summary, not a per-item link.
function wireSaveForLaterButton() {
  const btn = document.getElementById("cart-save-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const entries = CartStore.getRawEntries();
    if (!entries.length) return;

    entries.forEach((entry) => SavedForLaterStore.addItem(entry.id, entry.qty));
    CartStore.clear();

    renderCart();
    renderSavedForLater();
    if (typeof Vetra !== "undefined") Vetra.updateCartBadge();
    CustomerUI.info({ title: "Cart saved for later", bodyHtml: "Your items are waiting below whenever you're ready." });
  });
}

// One key per checkout attempt, not per click, reused across a retry of
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
    return crypto.randomUUID(); // sessionStorage unavailable, still usable for this one attempt
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

    // Same 0-stock rule renderCart() already shows inline, block the
    // attempt up front instead of letting the buyer find out only after
    // the backend rejects it (POST /api/orders would 400 on the same line).
    const outOfStockItem = items.find((i) => Number(i.product.stock_quantity) <= 0);
    if (outOfStockItem) {
      CustomerUI.info({
        title: "Remove out-of-stock items",
        bodyHtml: `"${VetraAPI.escapeHtml(outOfStockItem.product.name || "")}" is out of stock. Remove it from your cart to continue.`,
      });
      return;
    }

    // Checkout requires a buyer account. Send guests to account creation;
    // CartStore keeps their items in localStorage while they register.
    if (!VetraAPI.getToken("buyer")) {
      window.location.href = "../signup.html";
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
            // too, otherwise the second group's real order would look
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
          ? "Your cart had items from more than one store, so it was split into separate orders, one per vendor."
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
  renderSavedForLater();
  wireCartItemActions();
  wireSavedForLaterActions();
  wireSaveForLaterButton();
  wireCheckoutButton();
});
