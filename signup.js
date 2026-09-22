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
        ? "Let's get your store registered! Enter your name exactly as it appears on your identity document."
        : "Let's get you registered! Please write your first and last name exactly as they appear on your ID.";
    }
  };

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activateMode(btn.dataset.mode);
      closeEmailRoleModal();
    });
  });

  const hashMode = window.location.hash.replace('#', '');
  if (hashMode === 'Vendor') {
    activateMode('Vendor');
  }

  const continueBtn = document.querySelector('.continue-btn');
  const errorEl = document.getElementById('signup-error');
  const emailRoleModal = document.getElementById('email-role-modal');
  const emailRoleModalMessage = document.getElementById('email-role-modal-message');
  const emailRoleContinue = document.getElementById('email-role-continue');
  const emailRoleCancel = document.getElementById('email-role-cancel');

  function getActiveEmailField() {
    return document.getElementById(
      document.querySelector('.toggle button.active').dataset.mode === 'Vendor'
        ? 'business-email'
        : 'email'
    );
  }

  function closeEmailRoleModal() {
    if (emailRoleModal) emailRoleModal.hidden = true;
  }

  emailRoleCancel?.addEventListener('click', () => {
    closeEmailRoleModal();
    continueBtn.disabled = false;
    continueBtn.textContent = 'Continue';
    getActiveEmailField()?.focus();
  });

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
      // username/store-username are collected but not sent, the backend
      // has no username concept at all, only email (see api-client.js's
      // callers here and in signin.js). Includes <select> now too, the
      // required State dropdown, not just <input>.
      const requiredFields = activeForm.querySelectorAll('input[required], select[required]');

      let hasEmpty = false;
      let firstInvalidField = null;
      requiredFields.forEach(field => {
        const wrap = field.closest('.input-wrap');
        if (!field.value.trim()) {
          wrap.style.borderColor = '#e0475c';
          hasEmpty = true;
          firstInvalidField = firstInvalidField || field;
        } else {
          wrap.style.borderColor = '';
        }
      });

      if (hasEmpty) {
        showError('Please complete all required fields before continuing.');
        firstInvalidField?.focus();
        return;
      }
      const role = activeMode === 'Vendor' ? 'vendor' : 'buyer';
      const payload = role === 'vendor'
        ? {
            role,
            firstName: document.getElementById('vendor-first-name').value.trim(),
            middleName: document.getElementById('vendor-middle-name').value.trim(),
            lastName: document.getElementById('vendor-last-name').value.trim(),
            name: [
              document.getElementById('vendor-first-name').value.trim(),
              document.getElementById('vendor-middle-name').value.trim(),
              document.getElementById('vendor-last-name').value.trim(),
            ].filter(Boolean).join(' '),
            email: document.getElementById('business-email').value.trim(),
            password: document.getElementById('Vendor-password').value,
            phone: document.getElementById('business-phone').value.trim(),
            address: document.getElementById('business-address').value.trim(),
            state: document.getElementById('business-state').value,
            storeName: document.getElementById('business-name').value.trim(),
            storeCategory: document.getElementById('store-category').value,
          }
        : {
            role,
            name: `${document.getElementById('first-name').value.trim()} ${document.getElementById('last-name').value.trim()}`.trim(),
            email: document.getElementById('email').value.trim(),
            password: document.getElementById('password').value,
            phone: document.getElementById('phone').value.trim(),
            address: document.getElementById('address').value.trim(),
            state: document.getElementById('state').value,
          };

      const submitSignup = async (confirmOtherRole = false) => {
        continueBtn.textContent = 'Creating account…';
        continueBtn.disabled = true;
        closeEmailRoleModal();

        try {
          const data = await VetraAPI.request('/auth/signup', {
            method: 'POST',
            body: { ...payload, confirmOtherRole },
          });
          VetraAPI.setSession(role, data.token, data.user);

          window.location.href = `signin.html${activeMode === 'Vendor' ? '#Vendor' : ''}`;
        } catch (err) {
          if (err.status === 409 && err.data?.existingRole && !confirmOtherRole) {
            const existingLabel = err.data.existingRole === 'vendor' ? 'vendor' : 'buyer';
            const newLabel = role === 'vendor' ? 'vendor' : 'buyer';
            emailRoleModalMessage.textContent = `This email is already registered as a ${existingLabel}. You can still create a separate ${newLabel} account with it. Click Continue to finish creating this account.`;
            emailRoleModal.hidden = false;
            emailRoleContinue.onclick = () => submitSignup(true);
            return;
          }
          showError(err.message);
          continueBtn.textContent = 'Continue';
          continueBtn.disabled = false;
        }
      };

      await submitSignup();
    });
  }
});