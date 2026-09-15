/* =========================================================
   VETRA — PURCHASE HISTORY (customer app)
   A real, localStorage-backed record of which product ids this
   buyer has actually checked out — separate from CartStore, which
   only holds what's currently *in* the cart and gets cleared the
   moment checkout succeeds. This is what lets product.html's and
   store.html's review forms actually enforce "only after you've
   purchased it" instead of accepting any review from anyone, which
   is what both pages did before (their own hint text admitted as
   much: "this form simulates that check").

   Written by cart.js's checkout handler (see wireCheckoutButton())
   right before it clears the cart; read by product.html/store.html
   to decide whether to show the review form or a locked message.
   Always after products.js on any page that reads it, since
   hasPurchasedFromVendor() needs getProduct() to resolve each
   purchased id's vendorId.
   ========================================================= */

const PurchaseHistory = (() => {
  const LS_KEY = "vetra_customer_purchases";

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function save(ids) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(ids));
    } catch (e) {
      /* ignore write failures — still works for this page view */
    }
  }

  function recordPurchase(productIds) {
    const existing = new Set(load());
    productIds.forEach((id) => existing.add(id));
    save(Array.from(existing));
  }

  function hasPurchased(productId) {
    return load().includes(productId);
  }

  function hasPurchasedFromVendor(vendorId) {
    if (!vendorId) return false;
    return load().some((id) => {
      const product = typeof getProduct === "function" ? getProduct(id) : null;
      return !!product && product.vendorId === vendorId;
    });
  }

  return { recordPurchase, hasPurchased, hasPurchasedFromVendor };
})();
