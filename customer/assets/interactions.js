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

  // Product grids are built per-page (and, on store.html, per-vendor after
  // the page loads), so this listens on the document instead of binding to
  // each button directly — it still catches cards added after DOMContentLoaded.
  function wireAddToCartButtons() {
    document.addEventListener("click", (e) => {
      if (e.target.closest(".add-cart, .add-btn")) {
        window.location.href = "cart.html";
      }
    });
  }

  function init() {
    wireSidebarToggle();
    wireSidebarCollapse();
    wireBannerCarousel();
    wireAddToCartButtons();
  }

  return { wireSidebarToggle, wireSidebarCollapse, wireBannerCarousel, wireAddToCartButtons, init };
})();

document.addEventListener("DOMContentLoaded", () => Vetra.init());
