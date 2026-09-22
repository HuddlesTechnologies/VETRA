/* =========================================================
   VETRA: Shared page interactions (customer).

   Every page's header, sidebar, banner, categories, and product
   grid/bottom-nav markup now lives directly in each page's own
   HTML (it used to be built at runtime by this file). This file
   only wires up behavior on elements that already exist in the
   DOM when the page loads:
     - the header's sidebar toggle and the floating reopen button
     - the sidebar's collapse (icon-only) chevron
     - the banner carousel's dots and autoplay, where a banner
       exists (dashboard.html, explore.html)
     - every "Add to Cart" button (.add-cart / .add-btn), which
       takes the shopper to cart.html
   ========================================================= */

const Vetra = (() => {
  // wireSidebarToggle/wireSidebarCollapse now delegate to shared-ui.js's
  // VetraChrome (same implementation admin and vendor use), kept as
  // named functions here so Vetra's returned object keeps the same shape.
  function wireSidebarToggle() {
    VetraChrome.wireSidebarToggle();
  }

  function wireSidebarCollapse() {
    VetraChrome.wireSidebarCollapse();
  }

  function wireBannerCarousel(target = "#app-banner") {
    const el = document.querySelector(target);
    if (!el) return;
    const slideEls = el.querySelectorAll(".banner-slide");
    const dotEls = el.querySelectorAll(".dots span");
    if (!slideEls.length) return;
    let current = 0;

    function goTo(index) {
      slideEls[current].classList.remove("active");
      dotEls[current].classList.remove("active");
      current = index;
      slideEls[current].classList.add("active");
      dotEls[current].classList.add("active");
    }

    dotEls.forEach((dot, i) => dot.addEventListener("click", () => goTo(i)));

    if (slideEls.length > 1) {
      setInterval(() => goTo((current + 1) % slideEls.length), 4000);
    }
  }

  // Makes every product card (dashboard.html, explore.html, store.html,
  // anything carrying `data-product-id`) open that product's
  // detail page. Delegated and whole-card rather than wrapping each card's
  // image/name in an <a>, so it works uniformly across every page's own
  // card markup without restructuring any of it. Clicks on the card's own
  // real controls (Add to Cart, an actual link) are excluded so they keep
  // their own behavior instead of also navigating.
  function wireProductCardClicks() {
    document.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      const card = e.target.closest("[data-product-id]");
      if (!card) return;
      window.location.href = `product.html?id=${card.dataset.productId}`;
    });
  }

  // Product grids are built per-page (and, on store.html, per-vendor after
  // the page loads), so this listens on the document instead of binding to
  // each button directly, it still catches cards added after DOMContentLoaded.
  // Actually adds the clicked card's product to CartStore (assets/cart-store.js)
  // instead of just sending the shopper to cart.html empty-handed, every
  // card carries a `data-product-id` matching an entry in products.js's
  // PRODUCTS catalog, which is how the button knows what it's adding.
  function wireAddToCartButtons() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".add-cart, .add-btn");
      if (!btn) return;

      const card = btn.closest("[data-product-id]");
      const productId = card ? card.dataset.productId : null;
      if (card && Number(card.dataset.stock) <= 0) return; // out of stock, button is disabled, but guard stale state too
      if (!productId || typeof CartStore === "undefined") {
        // No catalog id on this card, or the cart store didn't load on
        // this page, fall back to the old behavior rather than silently
        // doing nothing.
        window.location.href = "cart.html";
        return;
      }

      // Grid cards carry their own qty stepper (assets/product-grid.js);
      // any card without one (e.g. an older/static card) just adds 1.
      const qtyValueEl = card ? card.querySelector(".product-qty-value") : null;
      const qty = qtyValueEl ? Math.max(1, Number(qtyValueEl.textContent) || 1) : 1;

      CartStore.addItem(productId, qty);
      updateCartBadge();

      // This card's own remaining-to-add cap just shrank, re-derive it
      // via the same CartStore.getRemainingStock() product-grid.js's card
      // builder used against the card's raw (un-adjusted) stock, now
      // that the add above has already persisted the new cart quantity.
      // card.dataset.stock stays the source of truth other code (this
      // same handler's next click, the stale-state guard above) reads,
      // so it has to be updated now, not just the visible stepper.
      // Falsy dataset.rawStock covers both "" (explicitly no cap) and a
      // card that never had it set at all (older/static markup), both
      // fall back to "no cap," same as everywhere else in this app.
      const rawStock = card.dataset.rawStock ? Number(card.dataset.rawStock) : null;
      const remaining = CartStore.getRemainingStock(productId, rawStock);
      card.dataset.stock = String(remaining);

      if (qtyValueEl) {
        qtyValueEl.textContent = remaining > 0 ? "1" : "0";
        const incrementBtn = card.querySelector(".product-qty-increment");
        if (incrementBtn) incrementBtn.disabled = remaining <= 1;
        const decrementBtn = card.querySelector(".product-qty-decrement");
        if (decrementBtn) decrementBtn.disabled = remaining <= 0;
      }

      if (remaining <= 0) {
        // Fully claimed by this shopper's own cart now, leave it
        // disabled and labeled, same treatment a genuinely 0-stock card
        // gets at render time, instead of reverting to a re-enabled
        // "Add to Cart" that would just let them keep adding past it.
        btn.textContent = "Out of Stock";
        btn.disabled = true;
        return;
      }

      // Brief inline feedback so clicking the button visibly did
      // something, without navigating the shopper away from what
      // they're browsing.
      const originalText = btn.textContent;
      btn.textContent = "Added ✓";
      btn.classList.add("added");
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove("added");
        btn.disabled = false;
      }, 1200);
    });
  }

  // Keeps every page's cart icon showing a live item count, icon markup
  // is `<a class="icon-btn" href="cart.html">` wrapping the cart SVG; a
  // count badge is appended/updated next to it rather than baked into
  // each page's static HTML, so it works the same everywhere without
  // every page needing its own copy of this element.
  function updateCartBadge() {
    if (typeof CartStore === "undefined") return;
    const count = CartStore.getCount();
    document.querySelectorAll('a[href="cart.html"].icon-btn').forEach((link) => {
      let badge = link.querySelector(".cart-count-badge");
      if (count > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "cart-count-badge";
          link.appendChild(badge);
        }
        badge.textContent = count > 99 ? "99+" : String(count);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  // Same badge pattern as updateCartBadge() above, aimed at the bell
  // icon (`<a class="icon-btn" href="notifications.html">`) instead,
  // real unread count from GET /api/notifications/unread-count, a
  // lightweight endpoint made for exactly this (called on every page's
  // header, not just notifications.html itself).
  async function updateNotificationBadge() {
    if (typeof VetraAPI === "undefined" || !VetraAPI.getUser("buyer")) return;
    let count = 0;
    try {
      const data = await VetraAPI.request("/notifications/unread-count", { method: "GET", role: "buyer" });
      count = data.count;
    } catch (err) {
      return; // leave whatever badge state was already there on failure
    }
    document.querySelectorAll('a[href="notifications.html"].icon-btn').forEach((link) => {
      let badge = link.querySelector(".notif-count-badge");
      if (count > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "notif-count-badge";
          link.appendChild(badge);
        }
        badge.textContent = count > 99 ? "99+" : String(count);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  // Reflects the real signed-in buyer's avatar in every page's header,
  // since it's the same header markup on every customer page. Reads the
  // real session (cached from sign-in/signup, or the last avatar upload,
  // see customer/settings.html) instead of a per-browser localStorage
  // mock; a brand-new account with no avatarUrl yet just keeps the
  // default placeholder already in the HTML. Called on every page load,
  // and again by settings.html right after a new photo is saved, so the
  // header updates immediately instead of only on the next navigation.
  function applyCurrentCustomerAvatar() {
    VetraChrome.applyAvatar("buyer");
  }

  function init() {
    wireSidebarToggle();
    wireSidebarCollapse();
    wireBannerCarousel();
    wireProductCardClicks();
    wireAddToCartButtons();
    updateCartBadge();
    updateNotificationBadge();
    applyCurrentCustomerAvatar();
  }

  return {
    wireSidebarToggle,
    wireSidebarCollapse,
    wireBannerCarousel,
    wireProductCardClicks,
    wireAddToCartButtons,
    updateCartBadge,
    updateNotificationBadge,
    applyCurrentCustomerAvatar,
    init,
  };
})();

document.addEventListener("DOMContentLoaded", () => Vetra.init());
