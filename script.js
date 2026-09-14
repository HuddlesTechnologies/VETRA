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
            // Number(n || 0) so an undefined/NaN input renders as ₦0 instead of ₦NaN.
            return '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
        }

        const nameField = document.getElementById('checkout-name');
        const emailField = document.getElementById('checkout-email');
        const phoneField = document.getElementById('checkout-phone');
        const addressField = document.getElementById('checkout-address');
        const detailFields = [nameField, phoneField, emailField, addressField];
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        function openCheckout(btn) {
            const product = btn.dataset.product;
            const vendor = btn.dataset.vendor;
            const price = parseNaira(btn.dataset.price);

            document.getElementById('checkout-vendor').textContent = vendor;
            document.getElementById('checkout-product-name').textContent = product;
            document.getElementById('checkout-product-price').textContent = formatNaira(price);
            document.getElementById('checkout-total-price').textContent = formatNaira(price + deliveryFee);

            // Reset the guest-details form and any previous validation state
            // every time a fresh checkout is opened.
            detailFields.forEach((f) => {
                f.value = '';
                f.style.borderColor = '';
            });

            stepReview.hidden = false;
            stepSuccess.hidden = true;
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm purchase';
            checkoutOverlay.hidden = false;
            nameField.focus();
        }

        function closeCheckout() {
            checkoutOverlay.hidden = true;
        }

        document.querySelectorAll('.buy-now-btn').forEach((btn) => {
            btn.addEventListener('click', () => openCheckout(btn));
        });

        confirmBtn.addEventListener('click', () => {
            // Guest checkout still needs to know who to deliver to and how
            // to reach them, so name/phone/email/address are required
            // before an order can be placed — same as a real checkout would.
            let hasError = false;
            detailFields.forEach((f) => {
                const empty = !f.value.trim();
                const invalid = f === emailField && !empty && !emailPattern.test(f.value.trim());
                f.style.borderColor = empty || invalid ? '#e0475c' : '';
                if (empty || invalid) hasError = true;
            });
            if (hasError) {
                detailFields.find((f) => f.style.borderColor)?.focus();
                return;
            }

            const product = document.getElementById('checkout-product-name').textContent;
            const buyerName = nameField.value.trim();
            const deliveryAddress = addressField.value.trim();

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Processing…';
            // TODO: replace with a real checkout/payment API call.
            setTimeout(() => {
                document.getElementById('checkout-success-text').textContent =
                    `Thanks, ${buyerName}! ${product} will be delivered to ${deliveryAddress}. A receipt has been sent to ${emailField.value.trim()}.`;
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