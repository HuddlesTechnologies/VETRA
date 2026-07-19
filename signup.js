document.addEventListener('DOMContentLoaded', function () {
  const toggleButtons = document.querySelectorAll('.toggle button');
  const buyerForm = document.getElementById('buyer-form');
  const sellerForm = document.getElementById('seller-form');

  toggleButtons.forEach((button) => {
    button.addEventListener('click', function () {
      toggleButtons.forEach((btn) => btn.classList.remove('active'));
      this.classList.add('active');

      if (this.textContent.trim() === 'Seller') {
        buyerForm.classList.add('hidden');
        sellerForm.classList.remove('hidden');
      } else {
        sellerForm.classList.add('hidden');
        buyerForm.classList.remove('hidden');
      }
    });
  });
});
