document.addEventListener('DOMContentLoaded', () => {
  const toggleBtns = document.querySelectorAll('.toggle button');
  const buyerForm = document.getElementById('buyer-form');
  const sellerForm = document.getElementById('seller-form');
  const subtitle = document.querySelector('.subtitle');

  const activateMode = (mode) => {
    toggleBtns.forEach(b => {
      const isActive = b.dataset.mode === mode;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    buyerForm.classList.toggle('hidden', mode !== 'buyer');
    sellerForm.classList.toggle('hidden', mode !== 'seller');
    if (subtitle) {
      subtitle.textContent = mode === 'seller'
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
  if (hashMode === 'seller') {
    activateMode('seller');
  }

  const continueBtn = document.querySelector('.continue-btn');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      const activeMode = document.querySelector('.toggle button.active').dataset.mode;
      const activeForm = activeMode === 'seller' ? sellerForm : buyerForm;
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
    });
  }
});