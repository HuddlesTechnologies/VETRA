/* =========================================================
   VETRA — SHARED LAYOUT SCRIPT
   Reusable render functions for building any page with the
   same header / banner / categories / product-grid / bottom-nav.

   HOW TO USE ON A NEW PAGE:
   1. Link css/style.css in <head>.
   2. Add empty containers with the ids used below
      (#app-header, #app-banner, #app-categories,
       #app-products, #app-bottomnav) wherever they belong
      on the page — or call Vetra.mountAll() to build the
      full stock layout inside <div class="phone"> in one go.
   3. Include this file, then call the Vetra.* functions with
      your own data (see the "DUMMY DATA" section — replace
      the "assets/images/..." paths with real image paths).
   ========================================================= */

const Vetra = (() => {

  /* ---------- ICONS (inline SVG, no image files needed) ---------- */
  const icons = {
    bell: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    cart: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
    search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    filter: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="var(--ink)"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="16" cy="18" r="2" fill="var(--ink)"/></svg>`,
    pin: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-7.5 8-13a8 8 0 1 0-16 0c0 5.5 8 13 8 13z"/><circle cx="12" cy="9" r="2.5"/></svg>`,
    home: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>`,
    category: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`,
    explore: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    chat: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
    wallet: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="16" cy="15" r="1.5" fill="currentColor" stroke="none"/></svg>`,
    contact: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M4 7l8 6 8-6"/></svg>`,
    logout: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`
  };

  /* Builds an <img> wrapped in the dashed placeholder box.
     Swap `src` for the real file path when it's ready —
     nothing else about the markup needs to change. */
  function placeholderImg(src, alt, extraClass = "") {
    return `<div class="img-placeholder ${extraClass}">
      <img src="${src}" alt="${alt}" onerror="this.style.display='none'; this.parentElement.insertAdjacentHTML('beforeend', '<span>${alt}</span>')">
    </div>`;
  }

  const icons2 = {
    menu: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    chevronLeft: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`
  };

  /* ---------- HEADER ---------- */
  // On desktop, the header-toggle button fully hides/reveals the sidebar
  // (a floating "reopen" button appears while it's hidden).
  function renderHeader(target = "#app-header", options = {}) {
    const el = document.querySelector(target);
    if (!el) return;
    const hideSearch = options.hideSearch === true;
    el.innerHTML = `
      <div class="topbar">
        <div style="display:flex;align-items:center;">
          <button class="header-toggle" id="header-sidebar-toggle" aria-label="Toggle sidebar">${icons2.menu}</button>
          <p class="logo">VETRA</p>
        </div>
        <div class="icon-actions">
          <div class="icon-btn">${icons.bell}</div>
          <div class="icon-btn">${icons.cart}</div>
        </div>
      </div>
      ${hideSearch ? '' : `
      <div class="searchbar">
        <button class="search-btn" aria-label="Search"><span>${icons.search}</span></button>
        <input type="text" placeholder="Search on Vetra" />
        <div class="filter-btn">${icons.filter}</div>
      </div>
      `}
    `;

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

  /* ---------- BANNER / CAROUSEL ---------- */
  // slides: [{ image, eyebrow, headline, headlineAccent, sub }]
  function renderBanner(slides, target = "#app-banner") {
    const el = document.querySelector(target);
    if (!el) return;

    el.innerHTML = `
      <div class="banner">
        ${slides.map((s, i) => `
          <div class="banner-slide ${i === 0 ? "active" : ""}" data-slide="${i}">
            <div class="banner-text">
              <p class="shout">${s.eyebrow}</p>
              <p class="off">${s.headline}<span>${s.headlineAccent || ""}</span></p>
              <p class="sub">${s.sub}</p>
            </div>
            ${placeholderImg(s.image, "banner image", "banner-art")}
          </div>
        `).join("")}
      </div>
      <div class="dots">
        ${slides.map((_, i) => `<span class="${i === 0 ? "active" : ""}" data-dot="${i}"></span>`).join("")}
      </div>
    `;

    const slideEls = el.querySelectorAll(".banner-slide");
    const dotEls = el.querySelectorAll(".dots span");
    let current = 0;

    function goTo(index) {
      slideEls[current].classList.remove("active");
      dotEls[current].classList.remove("active");
      current = index;
      slideEls[current].classList.add("active");
      dotEls[current].classList.add("active");
    }

    dotEls.forEach((dot, i) => dot.addEventListener("click", () => goTo(i)));

    if (slides.length > 1) {
      setInterval(() => goTo((current + 1) % slides.length), 4000);
    }
  }

  /* ---------- CATEGORIES ---------- */
  // categories: [{ image, label }]
  function renderCategories(categories, target = "#app-categories") {
    const el = document.querySelector(target);
    if (!el) return;
    el.innerHTML = `
      <div class="cat-head">
        <h3>CATEGORIES</h3>
        <button class="see-more">See more</button>
      </div>
      <div class="cat-scroll">
        ${categories.map(c => `
          <div class="cat-card">
            ${placeholderImg(c.image, c.label, "cat-thumb")}
            <span>${c.label}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* ---------- PRODUCT GRID ---------- */
  // products: [{ image, name, price, location }]
  function renderProducts(products, target = "#app-products") {
    const el = document.querySelector(target);
    if (!el) return;
    el.innerHTML = `
      <div class="grid">
        ${products.map(p => `
          <div class="product">
            ${placeholderImg(p.image, p.name, "product-img")}
            <div class="product-body">
              <p class="product-name">${p.name}</p>
              <p class="product-price">${p.price}</p>
              <p class="product-loc">${icons.pin} ${p.location}</p>
              <button class="add-cart">Add to Cart</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* ---------- SIDEBAR (web / desktop view) ---------- */
  // activeItem: "home" | "category" | "explore" | "chat" | "wallet" | "contact"
  // Collapse (icon-only) vs. fully-hide (via header-toggle) are two
  // separate controls: the sidebar-toggle chevron just narrows it,
  // the header menu button removes it completely.
  function renderSidebar(activeItem = "home", target = "#app-sidebar") {
    const el = document.querySelector(target);
    if (!el) return;
    const items = [
      { key: "home", label: "Home", icon: icons.home, href: "dashboard.html" },
      { key: "category", label: "Category", icon: icons.category, href: "category.html" },
      { key: "explore", label: "Explore", icon: icons.explore, href: "explore.html" },
      { key: "chat", label: "Chat", icon: icons.chat, href: "chat.html" },
      { key: "wallet", label: "Wallet", icon: icons.wallet, href: "wallet.html" },
      { key: "contact", label: "Contact", icon: icons.contact, href: "../contact.html" },
      { key: "logout", label: "Logout", icon: icons.logout, href: "../signin.html" }
    ];

    el.innerHTML = `
      <div class="sidebar-top">
        <span class="sidebar-logo">VETRA</span>
        <button class="sidebar-toggle" id="sidebar-collapse-toggle" aria-label="Collapse sidebar">
          ${icons2.chevronLeft}
        </button>
      </div>
      <nav class="sidebar-nav">
        ${items.map(item => `
          <a class="sidebar-link ${item.key === activeItem ? "active" : ""}" href="${item.href}">
            ${item.icon}
            <span>${item.label}</span>
          </a>
        `).join("")}
      </nav>
    `;

    const collapseBtn = document.getElementById("sidebar-collapse-toggle");
    if (collapseBtn) {
      collapseBtn.addEventListener("click", () => {
        el.classList.toggle("collapsed");
      });
    }
  }

  /* ---------- BOTTOM NAV ---------- */
  // activeItem: "home" | "category" | "explore" | "chat" | "wallet"
  function renderBottomNav(activeItem = "home", target = "#app-bottomnav") {
    const el = document.querySelector(target);
    if (!el) return;
    const items = [
      { key: "home", label: "Home", icon: icons.home, href: "dashboard.html" },
      { key: "category", label: "Category", icon: icons.category, href: "category.html" },
      { key: "explore", label: "Explore", icon: icons.explore, href: "explore.html" },
      { key: "chat", label: "Chat", icon: icons.chat, href: "chat.html" },
      { key: "wallet", label: "Wallet", icon: icons.wallet, href: "wallet.html" },
    ];
    el.innerHTML = items.map(item => `
      <a class="nav-item ${item.key === activeItem ? "active" : ""}" href="${item.href}">
        ${item.icon}
        ${item.label}
        ${item.key === activeItem ? '<span class="dot-indicator"></span>' : ""}
      </a>
    `).join("");
  }

  /* ---------- ONE-CALL PAGE BUILD ---------- */
  function mountAll({ slides, categories, products, activeNavItem = "home" }) {
    renderHeader();
    if (slides) renderBanner(slides);
    if (categories) renderCategories(categories);
    if (products) renderProducts(products);
    renderSidebar(activeNavItem);
    renderBottomNav(activeNavItem);
  }

  return {
    renderHeader,
    renderBanner,
    renderCategories,
    renderProducts,
    renderSidebar,
    renderBottomNav,
    mountAll
  };
})();


/* =========================================================
   DUMMY DATA — replace every "assets/images/..." path below
   with the real image file once it's ready. The layout does
   not need to change, only these paths.
   ========================================================= */

const DUMMY_SLIDES = [
  {
    image: "assets/images/banners/banner-1.jpg",
    eyebrow: "SHOP SMART!",
    headline: "Get<br>10",
    headlineAccent: "% off",
    sub: "your first order at Faster UAE!"
  },
  {
    image: "assets/images/banners/banner-2.jpg",
    eyebrow: "NEW ARRIVALS",
    headline: "Fresh<br>Picks",
    headlineAccent: "",
    sub: "check out this week's new listings"
  }
];

const DUMMY_CATEGORIES = [
  { image: "assets/images/categories/appliances.jpg", label: "Appliances" },
  { image: "assets/images/categories/phones-tablets.jpg", label: "Phones & Tablets" },
  { image: "assets/images/categories/health-beauty.jpg", label: "Health & Beauty" },
  { image: "assets/images/categories/home-office.jpg", label: "Home & Office" },
  { image: "assets/images/categories/electronics.jpg", label: "Electronics" },
  { image: "assets/images/categories/fashion.jpg", label: "Fashion" },
  { image: "assets/images/categories/computing.jpg", label: "Computing" }
];

const DUMMY_PRODUCTS = Array.from({ length: 12 }).map((_, i) => ({
  image: `assets/images/products/product-${i + 1}.jpg`,
  name: "Oraimo Power bank 250...",
  price: "17,489",
  location: "Asokoro, Abuja"
}));