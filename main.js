document.addEventListener('DOMContentLoaded', function () {
  // Highlight active nav link
  const links = document.querySelectorAll('.nav-links a');
  const path = window.location.pathname.split('/').pop() || 'index.html';
  links.forEach((a) => {
    if (a.getAttribute('href') === path) {
      a.classList.add('active-link');
    }
  });

  // Simple mobile menu toggle if needed in future
  const menuBtn = document.querySelector('.menu-btn');
  const nav = document.querySelector('.nav-links');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', () => nav.classList.toggle('open'));
  }
});
