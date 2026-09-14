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

    // Simulated checkout — "Popular this week" Buy now buttons.
    // No real payment/order backend exists yet, so this just walks through
    // the review -> confirm -> success shape a real checkout would have,
    // then hands off to the customer app the same way the guest-checkout
    // link on signin.html does.
    const checkoutOverlay = document.getElementById('checkout-overlay');
    if (checkoutOverlay) {
        const stepReview = document.getElementById('checkout-step-review');
        const stepSuccess = document.getElementById('checkout-step-success');
        const confirmBtn = document.getElementById('checkout-confirm-btn');
        const cancelBtn = document.getElementById('checkout-cancel-btn');
        const closeBtn = document.getElementById('checkout-close-btn');
        const deliveryFee = 1500;

        function parseNaira(text) {
            return Number(String(text).replace(/[^\d]/g, '')) || 0;
        }
        function formatNaira(n) {
            return '₦' + Math.round(n).toLocaleString('en-NG');
        }

        function openCheckout(btn) {
            const product = btn.dataset.product;
            const vendor = btn.dataset.vendor;
            const price = parseNaira(btn.dataset.price);

            document.getElementById('checkout-vendor').textContent = vendor;
            document.getElementById('checkout-product-name').textContent = product;
            document.getElementById('checkout-product-price').textContent = formatNaira(price);
            document.getElementById('checkout-total-price').textContent = formatNaira(price + deliveryFee);
            document.getElementById('checkout-success-text').textContent =
                `${product} will be delivered soon. A receipt has been sent to your email.`;

            stepReview.hidden = false;
            stepSuccess.hidden = true;
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm purchase';
            checkoutOverlay.hidden = false;
        }

        function closeCheckout() {
            checkoutOverlay.hidden = true;
        }

        document.querySelectorAll('.buy-now-btn').forEach((btn) => {
            btn.addEventListener('click', () => openCheckout(btn));
        });

        confirmBtn.addEventListener('click', () => {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Processing…';
            // TODO: replace with a real checkout/payment API call.
            setTimeout(() => {
                stepReview.hidden = true;
                stepSuccess.hidden = false;
            }, 700);
        });

        cancelBtn.addEventListener('click', closeCheckout);
        closeBtn.addEventListener('click', closeCheckout);
        checkoutOverlay.addEventListener('click', (e) => {
            if (e.target === checkoutOverlay) closeCheckout();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !checkoutOverlay.hidden) closeCheckout();
        });
    }
});