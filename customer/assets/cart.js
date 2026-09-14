/* =========================================================
   VETRA — CART PAGE INTERACTIONS (customer/cart.html)
   cart.html previously shipped its quantity steppers, "Contact
   vendor", "Save for later", and "Checkout" buttons with no JS
   behind any of them at all. This file wires all four, keeping
   the same "mock now, replace with a real API later" pattern
   used elsewhere in the customer/vendor apps (see
   vendor/assets/profile.js's danger-zone buttons).
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  wireQuantitySteppers();
  wireContactVendorButtons();
  wireSaveForLaterButton();
  wireCheckoutButton();
});

/* ---- Quantity steppers: recompute this line's price and the
   order summary every time a qty button is clicked. Each cart
   item's displayed price is read once on load to derive a
   per-unit price, since the mock markup only ships a line total. */
function wireQuantitySteppers() {
  const items = document.querySelectorAll(".cart-item");
  items.forEach((item) => {
    const qtyEl = item.querySelector(".cart-item-actions span");
    const priceEl = item.querySelector(".cart-price");
    if (!qtyEl || !priceEl) return;

    const initialQty = parseInt(qtyEl.textContent, 10) || 1;
    const initialTotal = parseNaira(priceEl.textContent);
    const unitPrice = initialTotal / initialQty;

    item.querySelectorAll(".qty-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        let qty = parseInt(qtyEl.textContent, 10) || 1;
        const isIncrement = btn.textContent.trim() === "+";
        qty = isIncrement ? qty + 1 : Math.max(1, qty - 1);
        qtyEl.textContent = qty;
        priceEl.textContent = formatNaira(unitPrice * qty);
        updateOrderSummary();
      });
    });
  });
}

function updateOrderSummary() {
  const lineTotals = Array.from(document.querySelectorAll(".cart-price")).map((el) =>
    parseNaira(el.textContent)
  );
  const subtotal = lineTotals.reduce((sum, n) => sum + n, 0);

  const summary = document.querySelector(".summary-card");
  if (!summary) return;

  const rows = summary.querySelectorAll(".summary-row");
  const subtotalRow = rows[0]?.querySelector("strong");
  const deliveryRow = rows[1]?.querySelector("strong");
  const totalRow = rows[2]?.querySelector("strong");
  if (!subtotalRow || !deliveryRow || !totalRow) return;

  const delivery = parseNaira(deliveryRow.textContent);
  subtotalRow.textContent = formatNaira(subtotal);
  totalRow.textContent = formatNaira(subtotal + delivery);
}

function parseNaira(text) {
  return Number(String(text).replace(/[^\d]/g, "")) || 0;
}

function formatNaira(n) {
  return "₦" + Math.round(n).toLocaleString("en-NG");
}

/* ---- Contact vendor: routes to the messaging app. There's no
   vendor-id mapping between cart line items and chat.html's mock
   conversations yet, so this opens the chat list rather than a
   specific thread — replace with a real per-vendor chat id once
   cart items carry one. */
function wireContactVendorButtons() {
  document.querySelectorAll(".contact-vendor-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.href = "chat.html";
    });
  });
}

/* ---- Save for later ---- */
function wireSaveForLaterButton() {
  const saveBtn = document.querySelector(".summary-card .secondary-btn");
  if (!saveBtn) return;
  saveBtn.addEventListener("click", () => {
    // TODO: replace with a real "move to saved items" API call.
    alert("Cart saved for later (hook this up to your save-for-later API).");
  });
}

/* ---- Checkout ---- */
function wireCheckoutButton() {
  const btn = document.querySelector(".summary-card .primary-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Processing…";

    // TODO: replace with a real checkout/payment API call.
    setTimeout(() => {
      alert("Order placed! (hook this up to your checkout/payment API)");
      btn.disabled = false;
      btn.textContent = originalText;
      window.location.href = "dashboard.html";
    }, 600);
  });
}
