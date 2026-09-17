/* =========================================================
   VETRA — SHARED PAGE INTERACTIONS (customer)

   Every page's header / sidebar / banner / categories / product
   grid / bottom-nav markup now lives directly in each page's own
   HTML (it used to be built at runtime by this file). This file
   only wires up behavior on elements that already exist in the
   DOM when the page loads:
     - the header's sidebar toggle + the floating reopen button
     - the sidebar's collapse (icon-only) chevron
     - the banner carousel's dots + autoplay, where a banner
       exists (dashboard.html, explore.html)
     - every "Add to Cart" button (.add-cart / .add-btn), which
       takes the shopper to cart.html
   ========================================================= */

const Vetra = (() => {
  function wireSidebarToggle() {
    const toggleBtn = document.getElementById("header-sidebar-toggle");
    const sidebar = document.getElementById("app-sidebar");
    const reopenBtn = document.getElementById("app-sidebar-reopen");
    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener("click", () => {
        sidebar.classList.toggle("hidden-desktop");
        const isHidden = sidebar.classList.contains("hidden-desktop");
        sidebar.style.display = isHidden ? "none" : "";
        if (reopenBtn) reopenBtn.classList.toggle("show", isHidden);
      });
    }
    if (reopenBtn && sidebar) {
      reopenBtn.addEventListener("click", () => {
        sidebar.classList.remove("hidden-desktop");
        sidebar.style.display = "";
        reopenBtn.classList.remove("show");
      });
    }
  }

  function wireSidebarCollapse() {
    const collapseBtn = document.getElementById("sidebar-collapse-toggle");
    const sidebar = document.getElementById("app-sidebar");
    if (collapseBtn && sidebar) {
      collapseBtn.addEventListener("click", () => {
        sidebar.classList.toggle("collapsed");
      });
    }
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

  // Makes every product card (dashboard.html, explore.html, store.html —
  // anything carrying `data-product-id`) open that product's
  // detail page. Delegated + whole-card rather than wrapping each card's
  // image/name in an <a>, so it works uniformly across every page's own
  // card markup without restructuring any of it — clicks on the card's own
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
  // each button directly — it still catches cards added after DOMContentLoaded.
  // Actually adds the clicked card's product to CartStore (assets/cart-store.js)
  // instead of just sending the shopper to cart.html empty-handed — every
  // card carries a `data-product-id` matching an entry in products.js's
  // PRODUCTS catalog, which is how the button knows what it's adding.
  function wireAddToCartButtons() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".add-cart, .add-btn");
      if (!btn) return;

      const card = btn.closest("[data-product-id]");
      const productId = card ? card.dataset.productId : null;
      if (!productId || typeof CartStore === "undefined") {
        // No catalog id on this card, or the cart store didn't load on
        // this page — fall back to the old behavior rather than silently
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

      // Reset the stepper back to 1 for the next add, and re-enable the
      // "+" button (it may have been sitting at the stock cap).
      if (qtyValueEl) {
        qtyValueEl.textContent = "1";
        const incrementBtn = card.querySelector(".product-qty-increment");
        if (incrementBtn) incrementBtn.disabled = Number(card.dataset.stock) <= 1;
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

  // Keeps every page's cart icon showing a live item count — icon markup
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
  // icon (`<a class="icon-btn" href="notifications.html">`) instead —
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

  // ---- Reflect the real signed-in buyer's avatar in every page's
  // header, since it's the same header markup on every customer page.
  // Reads the real session (cached from sign-in/signup, or the last
  // avatar upload — see customer/settings.html) instead of a
  // per-browser localStorage mock; a brand-new account with no
  // avatarUrl yet just keeps the default placeholder already in the
  // HTML. Called on every page load, and again by settings.html right
  // after a new photo is saved, so the header updates immediately
  // instead of only on the next navigation.
  function applyCurrentCustomerAvatar() {
    if (typeof VetraAPI === "undefined") return;
    const me = VetraAPI.getUser("buyer");
    if (!me || !me.avatarUrl) return;
    document.querySelectorAll(".header-avatar img").forEach((img) => {
      img.src = me.avatarUrl;
    });
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
