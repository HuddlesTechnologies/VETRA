// Mobile nav toggle
document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.nav-toggle');
    const links = document.querySelector('.nav-links');
    if (toggle && links) {
        toggle.addEventListener('click', () => {
            const open = links.classList.toggle('open');
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
            links.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        }));
    }

    // FAQ accordion
    document.querySelectorAll('.faq-item').forEach(item => {
        const q = item.querySelector('.faq-q');
        const a = item.querySelector('.faq-a');
        if (!q || !a) return;
        q.addEventListener('click', () => {
            const isOpen = item.classList.contains('open');
            document.querySelectorAll('.faq-item.open').forEach(el => {
                el.classList.remove('open');
                el.querySelector('.faq-a').style.maxHeight = null;
            });
            if (!isOpen) {
                item.classList.add('open');
                a.style.maxHeight = a.scrollHeight + 'px';
            }
        });
    });

    // Contact audience toggle (buyer / Vendor support)
    const toggleBtns = document.querySelectorAll('.audience-toggle button');
    const buyerPanel = document.getElementById('buyer-fields');
    const VendorPanel = document.getElementById('Vendor-fields');
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const mode = btn.dataset.mode;
            if (buyerPanel && VendorPanel) {
                buyerPanel.style.display = mode === 'buyer' ? 'grid' : 'none';
                VendorPanel.style.display = mode === 'Vendor' ? 'grid' : 'none';
            }
        });
    });

    // Contact form fake-submit
    const form = document.getElementById('contact-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = form.querySelector('button[type="submit"]');
            const original = btn.textContent;
            btn.textContent = 'Message sent';
            form.reset();
            setTimeout(() => { btn.textContent = original; }, 2600);
        });
    }

    // "Popular this week": real products from the live catalog
    // (GET /api/products, api-client.js), sorted by real sales_count
    // (ties/all-zero fall back to newest first), replaces four
    // hard-coded fake listings with fake vendors. "Buy now" adds the
    // item to the real customer cart (same localStorage key/shape
    // customer/assets/cart-store.js's CartStore reads) and hands off
    // to customer/cart.html, which already has a real, working,
    // idempotent checkout, instead of duplicating a second, fake
    // checkout flow here (the previous version collected a name/email/
    // address and then falsely told the buyer "a receipt has been
    // sent", nothing was ever ordered). Note: cart.js's checkout
    // currently requires a signed-in buyer regardless of
    // admin/settings.html's "guest checkout" toggle, that toggle only
    // gates the backend (POST /api/orders), the cart UI itself doesn't
    // yet read it and offer an unauthenticated checkout path.
    const popularGrid = document.getElementById('popular-products-grid');
    if (popularGrid && typeof VetraAPI !== 'undefined') {
        const CART_LS_KEY = 'vetra_customer_cart';

        function addToRealCart(productId) {
            let entries = [];
            try {
                const raw = localStorage.getItem(CART_LS_KEY);
                entries = raw ? JSON.parse(raw) : [];
                if (!Array.isArray(entries)) entries = [];
            } catch (e) {
                entries = [];
            }
            const existing = entries.find((e) => e.id === productId);
            if (existing) existing.qty += 1;
            else entries.push({ id: productId, qty: 1 });
            try {
                localStorage.setItem(CART_LS_KEY, JSON.stringify(entries));
            } catch (e) {
                /* localStorage unavailable (private mode, etc.) */
            }
        }

        function buildPopularCard(product) {
            const images = Array.isArray(product.images) ? product.images : [];
            const image = images[0] || 'customer/assets/images/product-placeholder.jpg';
            const name = VetraAPI.escapeHtml(product.name || '');
            const vendorName = VetraAPI.escapeHtml(product.vendor_name || 'Vendor');
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <a class="card-img" href="customer/product.html?id=${product.id}">
                    <img src="${image}" alt="${name}" loading="lazy" />
                </a>
                <div class="card-body">
                    <div class="Vendor-tag">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="#1e4fef">
                            <circle cx="12" cy="12" r="12" />
                            <path d="M7 12.5 L10.5 16 L17 8" stroke="#fff" stroke-width="2.2" fill="none" />
                        </svg>
                        ${vendorName}
                    </div>
                    <h4>${name}</h4>
                    <div class="price">${formatNaira(product.price)}</div>
                    <button type="button" class="btn btn-primary buy-now-btn" data-id="${product.id}">Buy now</button>
                </div>
            `;
            return card;
        }

        VetraAPI.request('/products')
            .then((products) => {
                if (!products.length) {
                    popularGrid.innerHTML = '';
                    document.getElementById('featured').hidden = true;
                    return;
                }
                const popular = [...products]
                    .sort((a, b) => Number(b.sales_count) - Number(a.sales_count) || new Date(b.created_at) - new Date(a.created_at))
                    .slice(0, 4);
                popularGrid.innerHTML = '';
                popular.forEach((p) => popularGrid.appendChild(buildPopularCard(p)));

                popularGrid.querySelectorAll('.buy-now-btn').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        addToRealCart(btn.dataset.id);
                        window.location.href = 'customer/cart.html';
                    });
                });
            })
            .catch(() => {
                popularGrid.innerHTML = '';
                document.getElementById('featured').hidden = true;
            });
    }
});