document.addEventListener('DOMContentLoaded', () => {
  const toggleBtns = document.querySelectorAll('.toggle button');
  const buyerForm = document.getElementById('buyer-form');
  const sellerForm = document.getElementById('seller-form');
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
      sellerForm.classList.toggle('hidden', mode !== 'seller');

      if (subtitle) {
        subtitle.textContent = mode === 'seller'
          ? "Let's get your store logged in. Please provide the information you registered with."
          : "Let's get you logged in. Please provide the information you registered with.";
      }
    });
  });

  const continueBtn = document.querySelector('.continue-btn');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      const activeMode = document.querySelector('.toggle button.active').dataset.mode;
      const usernameField = activeMode === 'seller'
        ? document.getElementById('store-username')
        : document.getElementById('username');
      const passwordField = activeMode === 'seller'
        ? document.getElementById('seller-password')
        : document.getElementById('password');

      if (!usernameField.value || !passwordField.value) {
        [usernameField, passwordField].forEach(f => {
          if (!f.value) f.style.borderColor = '#e0475c';
        });
        return;
      }
      continueBtn.textContent = 'Signing in…';
      continueBtn.disabled = true;
      // Redirect to dashboard after a short delay to show the signing state
      setTimeout(() => {
        window.location.href = 'customer/dashboard.html';
      }, 250);
    });
  }
});