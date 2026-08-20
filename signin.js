document.addEventListener('DOMContentLoaded', () => {
  const toggleBtns = document.querySelectorAll('.toggle button');
  const buyerForm = document.getElementById('buyer-form');
  const VendorForm = document.getElementById('Vendor-form');
  const subtitle = document.querySelector('.subtitle');

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

      if (subtitle) {
        subtitle.textContent = mode === 'Vendor'
          ? "Let's get your store logged in. Please provide the information you registered with."
          : "Let's get you logged in. Please provide the information you registered with.";
      }
    });
  });

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
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      // Determine which form (buyer or Vendor) is currently active
      const activeMode = document.querySelector('.toggle button.active').dataset.mode;

      // Grab the correct username/password fields for that mode
      const usernameField = activeMode === 'Vendor'
        ? document.getElementById('store-username')
        : document.getElementById('username');
      const passwordField = activeMode === 'Vendor'
        ? document.getElementById('Vendor-password')
        : document.getElementById('password');

      // Basic required-field validation
      if (!usernameField.value || !passwordField.value) {
        [usernameField, passwordField].forEach(f => {
          if (!f.value) f.style.borderColor = '#e0475c';
        });
        return;
      }

      continueBtn.textContent = 'Signing in…';
      continueBtn.disabled = true;

      // Redirect to the dashboard that matches the active sign-in mode
      // (buyer -> customer dashboard, Vendor -> vendor dashboard)
      const redirectPath = DASHBOARD_PATHS[activeMode] || DASHBOARD_PATHS.buyer;
      setTimeout(() => {
        window.location.href = redirectPath;
      }, 250);
    });
  }
});