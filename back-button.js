/* =========================================================
   VETRA: shared back button.
   Puts a "Go back" arrow at the start of the page header on every
   page that loads this script. It goes back in history when the
   visitor arrived from another VETRA page, and otherwise (opened from
   a link in an email, a bookmark, a new tab) goes to that app's home,
   so it never sends anyone off the site.

   Pages that already have their own back button (.store-back-btn on
   product/store/vendors) are left alone.
   ========================================================= */

(() => {
  function homeFor(path) {
    if (/\/customer\//.test(path)) return "dashboard.html";
    if (/\/vendor\//.test(path)) return "dashboard.html";
    if (/\/admin\//.test(path)) return "dashboard.html";
    if (/\/rider\//.test(path)) return "index.html";
    return "index.html";
  }

  function goBack() {
    let sameSite = false;
    try {
      sameSite = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch (e) {
      sameSite = false;
    }
    if (sameSite && window.history.length > 1) window.history.back();
    else window.location.href = homeFor(window.location.pathname);
  }

  function injectStyles() {
    if (document.getElementById("vetra-back-btn-styles")) return;
    const style = document.createElement("style");
    style.id = "vetra-back-btn-styles";
    style.textContent = `
      .vetra-back-btn {
        flex: 0 0 auto;
        width: 36px;
        height: 36px;
        margin-right: 6px;
        border-radius: 50%;
        border: none;
        background: var(--c-fill, rgba(120, 120, 128, 0.12));
        color: var(--c-accent, #3b6cf6);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background .15s ease, transform .15s ease;
      }
      .vetra-back-btn:hover { transform: translateX(-1px); }
      .vetra-back-btn:focus-visible { outline: 2px solid var(--c-accent, #3b6cf6); outline-offset: 2px; }
    `;
    document.head.appendChild(style);
  }

  function mount() {
    if (document.querySelector(".store-back-btn, .vetra-back-btn")) return;
    // App pages: the left group of the header's top bar. Public pages:
    // the site nav. Sign-in pages: their own top bar. Rider: its header.
    const host =
      document.querySelector("#app-header .topbar > div:first-child") ||
      document.querySelector("header .topbar > div:first-child") ||
      document.querySelector("header.site nav.nav") ||
      document.querySelector(".frame > .topbar") ||
      document.querySelector(".rider-header");
    if (!host) return;
    injectStyles();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vetra-back-btn";
    btn.setAttribute("aria-label", "Go back");
    btn.title = "Go back";
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>';
    btn.addEventListener("click", goBack);
    host.insertBefore(btn, host.firstChild);
    if (getComputedStyle(host).display !== "flex") {
      host.style.display = "flex";
      host.style.alignItems = "center";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
