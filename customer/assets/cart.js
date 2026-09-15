/* =========================================================
   VETRA — CART PAGE (customer/cart.html)
   Renders real cart contents from CartStore (assets/cart-store.js)
   — there is no more static/dummy line-item markup on this page,
   everything below is built from whatever a shopper actually
   clicked "Add to Cart" on. Quantity steppers and Remove act
   directly on CartStore and re-render; Checkout clears the cart
   the same way the homepage's mock checkout flow does.
   ========================================================= */

const DELIVERY_FEE = 1500; // flat fee, matches the homepage's mock checkout modal

function formatNaira(n) {
  return "₦" + Number(n || 0).toLocaleString("en-NG");
}

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
      const vendorLink =
        product.vendorId && typeof PRODUCT_VENDOR_NAMES !== "undefined" && PRODUCT_VENDOR_NAMES[product.vendorId]
          ? `<a class="contact-vendor-btn" href="store.html?vendor=${product.vendorId}" style="text-decoration:none; display:inline-block;">Visit store</a>`
          : "";
      return `
        <div class="cart-item" data-product-id="${id}">
          <div class="cart-item-main">
            <a class="cart-thumb" href="product.html?id=${id}" aria-label="View ${product.name}">
              <img src="${product.image}" alt="${product.name}" />
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
  const total = subtotal + DELIVERY_FEE;
  document.getElementById("cart-subtotal").textContent = formatNaira(subtotal);
  document.getElementById("cart-delivery").textContent = formatNaira(DELIVERY_FEE);
  document.getElementById("cart-total").textContent = formatNaira(total);
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
    alert("Cart saved for later (hook this up to your save-for-later API).");
  });
}

function wireCheckoutButton() {
  const btn = document.getElementById("cart-checkout-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    if (!CartStore.getItems().length) return;

    btn.disabled = true;
    btn.textContent = "Processing…";

    setTimeout(() => {
      // TODO: replace with a real checkout/payment API call.
      const purchasedIds = CartStore.getItems().map((item) => item.id);
      alert("Order placed! (hook this up to your checkout/payment API)");
      if (typeof PurchaseHistory !== "undefined") PurchaseHistory.recordPurchase(purchasedIds);
      CartStore.clear();
      if (typeof Vetra !== "undefined") Vetra.updateCartBadge();
      window.location.href = "dashboard.html";
    }, 600);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderCart();
  wireCartItemActions();
  wireSaveForLaterButton();
  wireCheckoutButton();
});
