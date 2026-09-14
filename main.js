/* =========================================================
   VETRA — PUBLIC SITE NAV HELPERS
   Loaded on the public marketing pages (index/about/contact).
   Just two small pieces of behavior:
     - highlight whichever nav link matches the current page
     - toggle the mobile nav menu open/closed, if one exists
   ========================================================= */

document.addEventListener('DOMContentLoaded', function () {
  // Highlight active nav link: compare each link's href against the
  // current page's filename (falls back to index.html for the root "/").
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
