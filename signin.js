document.addEventListener('DOMContentLoaded', () => {
  const toggleBtns = document.querySelectorAll('.toggle button');
  const buyerForm = document.getElementById('buyer-form');
  const VendorForm = document.getElementById('Vendor-form');
  const subtitle = document.querySelector('.subtitle');
  const guestContinueWrap = document.getElementById('guest-continue-wrap');

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      const mode = btn.dataset.mode;
      buyerForm.classList.toggle('hidden', mode !== 'buyer');
      VendorForm.classList.toggle('hidden', mode !== 'Vendor');
      // Guest checkout is a buyer-only concept — hide the shortcut on the
      // Vendor tab.
      if (guestContinueWrap) guestContinueWrap.classList.toggle('hidden', mode !== 'buyer');

      if (subtitle) {
        subtitle.textContent = mode === 'Vendor'
          ? "Let's get your store logged in. Please provide the information you registered with."
          : "Let's get you logged in. Please provide the information you registered with.";
      }
    });
  });

  // Land directly on the Vendor tab when arriving as signin.html#Vendor
  // (e.g. right after registering a vendor account on signup.html).
  const hashMode = window.location.hash.replace('#', '');
  if (hashMode === 'Vendor') {
    document.querySelector('.toggle button[data-mode="Vendor"]')?.click();
  }

  // ---------------------------------------------------------------------
  // DASHBOARD REDIRECT PATHS
  // Update these two paths if the folder structure changes later.
  //   - Buyer  -> customer dashboard
  //   - Vendor -> vendor dashboard
  // ---------------------------------------------------------------------
  const DASHBOARD_PATHS = {
    buyer: 'customer/dashboard.html',
    Vendor: 'vendor/dashboard.html'
  };

  const continueBtn = document.querySelector('.continue-btn');
  const errorEl = document.getElementById('signin-error');

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', async () => {
      if (errorEl) errorEl.hidden = true;

      // Determine which form (buyer or Vendor) is currently active
      const activeMode = document.querySelector('.toggle button.active').dataset.mode;

      // Grab the correct email/password fields for that mode
      const emailField = activeMode === 'Vendor'
        ? document.getElementById('store-username')
        : document.getElementById('username');
      const passwordField = activeMode === 'Vendor'
        ? document.getElementById('Vendor-password')
        : document.getElementById('password');

      // Basic required-field validation
      if (!emailField.value || !passwordField.value) {
        [emailField, passwordField].forEach(f => {
          if (!f.value) f.style.borderColor = '#e0475c';
        });
        return;
      }

      continueBtn.textContent = 'Signing in…';
      continueBtn.disabled = true;

      const role = activeMode === 'Vendor' ? 'vendor' : 'buyer';

      try {
        const data = await VetraAPI.request('/auth/signin', {
          method: 'POST',
          body: { role, email: emailField.value.trim(), password: passwordField.value },
        });
        VetraAPI.setSession(role, data.token, data.user);

        // Redirect to the dashboard that matches the active sign-in mode
        // (buyer -> customer dashboard, Vendor -> vendor dashboard) — every
        // page in that app still runs on its own mock data for now (see
        // BACKEND_GUIDE.md), this just establishes the real session.
        window.location.href = DASHBOARD_PATHS[activeMode] || DASHBOARD_PATHS.buyer;
      } catch (err) {
        showError(err.message);
        continueBtn.textContent = 'Continue';
        continueBtn.disabled = false;
      }
    });
  }
});