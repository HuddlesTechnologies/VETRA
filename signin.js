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

  // ---- Two-factor step (see /auth/signin's twoFactorRequired response,
  // backend/src/routes/auth.routes.js) — swaps the whole panel below the
  // title for a single code field, then restores it on "use a different
  // account" so the buyer/vendor toggle + Google button aren't sitting
  // there mid-code-entry. ----
  const toggleWrap = document.querySelector('.toggle');
  const twoFactorForm = document.getElementById('two-factor-form');
  const twoFactorEmailEl = document.getElementById('two-factor-email');
  const codeField = document.getElementById('two-factor-code');
  const verifyBtn = document.getElementById('two-factor-verify-btn');
  const twoFactorActions = document.getElementById('two-factor-actions');
  const resendLink = document.getElementById('two-factor-resend');
  const backLink = document.getElementById('two-factor-back');
  const swapWithTwoFactor = [toggleWrap, buyerForm, VendorForm, document.getElementById('signin-divider'), document.getElementById('google-signin-wrap'), guestContinueWrap, document.getElementById('signin-signup-wrap'), document.getElementById('signin-admin-wrap')].filter(Boolean);

  let pendingRole = null;
  let pendingUserId = null;

  function enterTwoFactorStep(role, userId, email) {
    pendingRole = role;
    pendingUserId = userId;
    twoFactorEmailEl.textContent = email;
    swapWithTwoFactor.forEach((el) => el.classList.add('hidden'));
    continueBtn.classList.add('hidden');
    twoFactorForm.classList.remove('hidden');
    verifyBtn.classList.remove('hidden');
    twoFactorActions.classList.remove('hidden');
    codeField.focus();
  }

  function backToCredentialsStep() {
    pendingRole = null;
    pendingUserId = null;
    codeField.value = '';
    if (errorEl) errorEl.hidden = true;
    twoFactorForm.classList.add('hidden');
    verifyBtn.classList.add('hidden');
    twoFactorActions.classList.add('hidden');
    swapWithTwoFactor.forEach((el) => el.classList.remove('hidden'));
    // Re-apply the active mode's own show/hide (guest link + one of the
    // two credential forms should stay in their mode-correct state).
    document.querySelector('.toggle button.active')?.click();
    continueBtn.classList.remove('hidden');
  }

  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      if (errorEl) errorEl.hidden = true;
      const code = codeField.value.trim();
      if (!code) {
        codeField.closest('.input-wrap').style.borderColor = '#e0475c';
        return;
      }

      verifyBtn.textContent = 'Verifying…';
      verifyBtn.disabled = true;

      try {
        const data = await VetraAPI.request('/auth/2fa/verify', {
          method: 'POST',
          body: { userId: pendingUserId, code },
        });
        VetraAPI.setSession(pendingRole, data.token, data.user);
        window.location.href = DASHBOARD_PATHS[pendingRole === 'vendor' ? 'Vendor' : 'buyer'] || DASHBOARD_PATHS.buyer;
      } catch (err) {
        showError(err.message);
        verifyBtn.textContent = 'Verify code';
        verifyBtn.disabled = false;
      }
    });
  }

  if (resendLink) {
    resendLink.addEventListener('click', async (e) => {
      e.preventDefault();
      if (errorEl) errorEl.hidden = true;
      resendLink.textContent = 'Sending…';
      try {
        await VetraAPI.request('/auth/2fa/resend', { method: 'POST', body: { userId: pendingUserId } });
        resendLink.textContent = 'Code sent';
        setTimeout(() => { resendLink.textContent = 'Resend code'; }, 4000);
      } catch (err) {
        showError(err.message);
        resendLink.textContent = 'Resend code';
      }
    });
  }

  if (backLink) {
    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      backToCredentialsStep();
    });
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
        if (data.twoFactorRequired) {
          enterTwoFactorStep(role, data.userId, emailField.value.trim());
          continueBtn.textContent = 'Continue';
          continueBtn.disabled = false;
          return;
        }
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