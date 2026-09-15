document.addEventListener('DOMContentLoaded', () => {
  const toggleBtns = document.querySelectorAll('.toggle button');
  const buyerForm = document.getElementById('buyer-form');
  const VendorForm = document.getElementById('Vendor-form');
  const subtitle = document.querySelector('.subtitle');

  const activateMode = (mode) => {
    toggleBtns.forEach(b => {
      const isActive = b.dataset.mode === mode;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    buyerForm.classList.toggle('hidden', mode !== 'buyer');
    VendorForm.classList.toggle('hidden', mode !== 'Vendor');
    if (subtitle) {
      subtitle.textContent = mode === 'Vendor'
        ? "Let's get your store registered! Please provide your business details exactly as they appear on your official documents."
        : "Let's get you registered! Please write your first and last name exactly as they appear on your ID.";
    }
  };

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activateMode(btn.dataset.mode);
    });
  });

  const hashMode = window.location.hash.replace('#', '');
  if (hashMode === 'Vendor') {
    activateMode('Vendor');
  }

  const continueBtn = document.querySelector('.continue-btn');
  const errorEl = document.getElementById('signup-error');

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', async () => {
      if (errorEl) errorEl.hidden = true;

      const activeMode = document.querySelector('.toggle button.active').dataset.mode;
      const activeForm = activeMode === 'Vendor' ? VendorForm : buyerForm;
      // username/store-username are collected but not sent — the backend
      // has no username concept at all, only email (see api-client.js's
      // callers here and in signin.js).
      const requiredFields = activeForm.querySelectorAll('input');

      let hasEmpty = false;
      requiredFields.forEach(field => {
        const wrap = field.closest('.input-wrap');
        if (!field.value.trim()) {
          wrap.style.borderColor = '#e0475c';
          hasEmpty = true;
        } else {
          wrap.style.borderColor = '';
        }
      });

      if (hasEmpty) return;
      continueBtn.textContent = 'Creating account…';
      continueBtn.disabled = true;

      const role = activeMode === 'Vendor' ? 'vendor' : 'buyer';
      const payload = role === 'vendor'
        ? {
            role,
            name: document.getElementById('owner-name').value.trim(),
            email: document.getElementById('business-email').value.trim(),
            password: document.getElementById('Vendor-password').value,
            phone: document.getElementById('business-phone').value.trim(),
            storeName: document.getElementById('business-name').value.trim(),
          }
        : {
            role,
            name: `${document.getElementById('first-name').value.trim()} ${document.getElementById('last-name').value.trim()}`.trim(),
            email: document.getElementById('email').value.trim(),
            password: document.getElementById('password').value,
            phone: document.getElementById('phone').value.trim(),
          };

      try {
        const data = await VetraAPI.request('/auth/signup', { method: 'POST', body: payload });
        VetraAPI.setSession(role, data.token, data.user);

        // Send the new account straight to sign in with the mode it just
        // registered under — matches the pre-backend redirect behavior,
        // now backed by a real signed-up account instead of a no-op.
        window.location.href = `signin.html${activeMode === 'Vendor' ? '#Vendor' : ''}`;
      } catch (err) {
        showError(err.message);
        continueBtn.textContent = 'Continue';
        continueBtn.disabled = false;
      }
    });
  }
});