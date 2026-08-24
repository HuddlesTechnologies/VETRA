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
    contact: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
</svg>`,
    logout: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`,
    /* Simple user-circle icon — used for the "Profile" nav entry
       (e.g. swapped in for "Support" in the vendor sidebar/bottom-nav). */
    profile: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>`,
    /* ---- VENDOR-ONLY ICONS (used by vendor/js/vendor-dashboard.js) ---- */
    box: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12l8.73-5.04"/><path d="M12 22.08V12"/></svg>`,
    receipt: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>`,
    wallet: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h3v-4z"/></svg>`,
   plus: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    eye: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    /* ---- used by vendor/js/vendor-profile.js (quick-stats row) ---- */
    star: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    calendar: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    camera: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`
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
  //
  // options:
  //   showSearch  (bool) — render the search bar under the topbar
  //   showSupport (bool) — render a support icon-button in the topbar,
  //                        to the left of the notification bell. Used by
  //                        vendor/js/vendor-dashboard.js so the support
  //                        entry lives in the header instead of the sidebar
  //                        on vendor pages, on both mobile and desktop.
  function renderHeader(target = "#app-header", options = {}) {
    const el = document.querySelector(target);
    if (!el) return;
    const showSearch = options.showSearch === true;
    const showSupport = options.showSupport === true;
   el.innerHTML = `
      <div class="topbar">
        <div style="display:flex;align-items:center;">
          <button class="header-toggle" id="header-sidebar-toggle" aria-label="Toggle sidebar">${icons2.menu}</button>
          <p class="logo">VETRA</p>
        </div>
        <div class="icon-actions">
          ${showSupport ? `<a class="icon-btn support-btn" id="header-support-btn" href="#" aria-label="Support">${icons.contact}</a>` : ''}
          <a class="icon-btn" href="notifications.html" aria-label="Notifications">${icons.bell}</a>
        </div>
      </div>
      ${showSearch ? `
      <div class="searchbar">
        <button class="search-btn" aria-label="Search"><span>${icons.search}</span></button>
        <input type="text" placeholder="Search on Vetra" />
        <div class="filter-btn">${icons.filter}</div>
      </div>
      ` : ''}
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
  // activeItem: "home" | "category" | "explore" | "chat" | "contact"
  // Collapse (icon-only) vs. fully-hide (via header-toggle) are two
  // separate controls: the sidebar-toggle chevron just narrows it,
  // the header menu button removes it completely.
  // customItems: optional override array of { key, label, icon, href, class }.
  // Pass this in from a page-specific script (e.g. vendor/js/vendor-dashboard.js)
  // to swap in a different nav set (vendor nav) without touching this shared file.
  // Leave it out/null and the default buyer nav below is used, unchanged.
  function renderSidebar(activeItem = "home", target = "#app-sidebar", customItems = null) {
    const el = document.querySelector(target);
    if (!el) return;
    const items = customItems || [
      { key: "home", label: "Home", icon: icons.home, href: "dashboard.html" },
      { key: "category", label: "Category", icon: icons.category, href: "category.html" },
      { key: "explore", label: "Explore", icon: icons.explore, href: "explore.html" },
      {
        key: "contact",
        label: "Support",
        icon: icons.contact,
        href: "#",
        class: "support-btn"
      },
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
         <a
    href="${item.href}"
    class="sidebar-link ${item.class || ""} ${item.key === activeItem ? "active" : ""}">

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
  // activeItem: "home" | "category" | "explore" | "chat"
  // customItems: same override pattern as renderSidebar() above.
  function renderBottomNav(activeItem = "home", target = "#app-bottomnav", customItems = null) {
    const el = document.querySelector(target);
    if (!el) return;
    const items = customItems || [
      { key: "home", label: "Home", icon: icons.home, href: "dashboard.html" },
      { key: "category", label: "Category", icon: icons.category, href: "category.html" },
      { key: "explore", label: "Explore", icon: icons.explore, href: "explore.html" },
      {
        key: "contact",
        label: "Support",
        icon: icons.contact,
        href: "#",
        class: "support-btn"
      },

    ];
    el.innerHTML = items.map(item => `
     <a
    href="${item.href}"
    class="nav-item ${item.class || ""} ${item.key === activeItem ? "active" : ""}">

    ${item.icon}
    ${item.label}

    ${item.key === activeItem ? '<span class="dot-indicator"></span>' : ""}

</a>
    `).join("");
  }

  /* ---------- ONE-CALL PAGE BUILD ---------- */
  function mountAll({ slides, categories, products, activeNavItem = "home", navItems = null }) {
    renderHeader();
    if (slides) renderBanner(slides);
    if (categories) renderCategories(categories);
    if (products) renderProducts(products);
    renderSidebar(activeNavItem, "#app-sidebar", navItems);
    renderBottomNav(activeNavItem, "#app-bottomnav", navItems);
  }

  return {
    renderHeader,
    renderBanner,
    renderCategories,
    renderProducts,
    renderSidebar,
    renderBottomNav,
    mountAll,
    // Exposed so other page-specific scripts (e.g. vendor/js/vendor-dashboard.js)
    // can reuse the same icon set instead of redefining their own SVGs.
    icons,
    icons2
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


/* =========================================================
   VETRA — VENDOR PROFILE PAGE (vendor/profile.html only)
   Folded into layout.js so profile.html only needs one script
   tag. Everything below is guarded to run only when it finds
   #profile-form in the page — i.e. only on profile.html — so
   it stays completely inert everywhere else layout.js is
   loaded (buyer pages, vendor/dashboard.html, etc.).

   Named PROFILE_NAV_ITEMS (not VENDOR_NAV_ITEMS) on purpose:
   vendor/js/vendor-dashboard.js declares its own VENDOR_NAV_ITEMS
   as a plain global, and dashboard.html loads both that file and
   this one — same name would throw a duplicate-const error.
   ========================================================= */

const PROFILE_NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: Vetra.icons.home, href: "dashboard.html" },
  { key: "products", label: "Products", icon: Vetra.icons.box, href: "products.html" },
  { key: "orders", label: "Orders", icon: Vetra.icons.receipt, href: "orders.html" },
  { key: "earnings", label: "Earnings", icon: Vetra.icons.wallet, href: "earnings.html" },
  { key: "profile", label: "Profile", icon: Vetra.icons.profile, href: "profile.html" },

];

// stats: [{ label, value, icon }]
const DUMMY_VENDOR_QUICK_STATS = [
  { label: "Orders Completed", value: "312", icon: Vetra.icons.receipt },
  { label: "Member Since", value: "Jan 2024", icon: Vetra.icons.calendar }
];

/* ---------- QUICK STATS ---------- */
function renderProfileStats(stats, target = "#profile-stats") {
  const el = document.querySelector(target);
  if (!el) return;
  el.innerHTML = `
    <div class="stat-grid">
      ${stats.map(s => `
        <div class="stat-card">
          <div class="stat-card-head">
            <p class="stat-label">${s.label}</p>
            <span class="stat-icon">${s.icon}</span>
          </div>
          <p class="stat-value">${s.value}</p>
        </div>
      `).join("")}
    </div>
  `;
}

/* ---------- VERIFIED BADGE ---------- */
function renderProfileBadge(target = "#profile-badge") {
  const el = document.querySelector(target);
  if (!el) return;
  el.innerHTML = `${Vetra.icons.star} Verified Vendor`;
}

/* ---------- AVATAR EDIT ---------- */
function wireAvatarEditButton() {
  const btn = document.getElementById("avatar-edit-btn");
  if (!btn) return;
  btn.innerHTML = Vetra.icons.camera;
  btn.addEventListener("click", () => {
    // TODO: replace with a real file picker + upload call.
    alert("Hook this up to your avatar upload flow.");
  });
}

/* ---------- STORE DETAILS FORM — locked until "Edit Profile" ----------
   Every field in #profile-form ships with the `readonly` attribute in
   profile.html, so nothing is editable on page load. Clicking "Edit
   Profile" is the only thing that unlocks them; Save or Cancel both
   lock them again afterwards. */
function setProfileFormEditable(editable) {
  const form = document.getElementById("profile-form");
  if (!form) return;
  form.querySelectorAll(".form-input, .form-textarea").forEach(field => {
    field.readOnly = !editable;
  });
  form.classList.toggle("is-editing", editable);
}

/* ---------- HEADER "EDIT PROFILE" SHORTCUT ---------- */
function wireProfileEditButton() {
  const btn = document.getElementById("profile-edit-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    setProfileFormEditable(true);
    document.getElementById("store-name")?.focus();
    document.getElementById("profile-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

/* ---------- STORE DETAILS FORM ---------- */
function wireProfileForm() {
  const form = document.getElementById("profile-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    // TODO: replace with a real save API call. For now, just reflect
    // the store name / owner name back onto the summary card so the
    // page feels responsive.
    const storeName = document.getElementById("store-name")?.value.trim();
    const ownerName = document.getElementById("owner-name")?.value.trim();
    if (storeName) document.getElementById("profile-store-name").textContent = storeName;
    if (ownerName) {
      document.getElementById("profile-owner-name").textContent = `${ownerName} · Vendor since Jan 2024`;
    }
    setProfileFormEditable(false);
    alert("Profile saved (hook this up to your save API).");
  });

  const cancelBtn = document.getElementById("profile-cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      form.reset();
      setProfileFormEditable(false);
    });
  }
}

/* ---------- SECURITY ---------- */
function wireChangePasswordButton() {
  const btn = document.getElementById("change-password-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // TODO: replace with real navigation to a change-password flow.
    alert("Hook this up to your change-password flow.");
  });
}

/* ---------- DANGER ZONE ---------- */
function wireDangerZoneButtons() {
  const deactivateBtn = document.getElementById("deactivate-store-btn");
  if (deactivateBtn) {
    deactivateBtn.addEventListener("click", () => {
      const confirmed = confirm("Deactivate your store? Buyers won't be able to see your listings until you reactivate.");
      if (confirmed) {
        // TODO: replace with a real deactivate API call.
        alert("Store deactivated (hook this up to your API).");
      }
    });
  }

  const deleteBtn = document.getElementById("delete-account-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      const confirmed = confirm("Delete your vendor account? This cannot be undone.");
      if (confirmed) {
        // TODO: replace with a real delete-account API call.
        alert("Account deletion requested (hook this up to your API).");
      }
    });
  }
}

/* ---------- SIGN OUT ---------- */
function wireSignOutButton() {
  const btn = document.getElementById("sign-out-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const confirmed = confirm("Sign out of your vendor account?");
    if (confirmed) {
      // Same destination as the "Logout" link in the default sidebar nav.
      window.location.href = "../signin.html";
    }
  });
}

/* ---------- HEADER SUPPORT BUTTON (profile page) ----------
   Same pattern as vendor/js/vendor-dashboard.js — support lives in
   the header (mobile + desktop) rather than the sidebar/bottom-nav. */
function wireProfileHeaderSupportButton() {
  const btn = document.getElementById("header-support-btn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    // TODO: replace with real navigation or a support/chat widget, e.g.
    // window.location.href = "support.html";
    alert("Hook this up to your support flow.");
  });
}

/* ---------- PAGE INIT (guarded — profile.html only) ----------
   #profile-form only exists in profile.html's markup, so this
   whole block is a no-op on every other page that loads layout.js. */
document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("profile-form")) return;

  Vetra.renderHeader("#app-header", { showSupport: true });
  Vetra.renderSidebar("profile", "#app-sidebar", PROFILE_NAV_ITEMS);
  Vetra.renderBottomNav("profile", "#app-bottomnav", PROFILE_NAV_ITEMS);

  renderProfileStats(DUMMY_VENDOR_QUICK_STATS);
  renderProfileBadge();
  wireAvatarEditButton();
  wireProfileEditButton();
  wireProfileForm();
  wireChangePasswordButton();
  wireDangerZoneButtons();
  wireSignOutButton();
  wireProfileHeaderSupportButton();
});