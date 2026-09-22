/* =========================================================
   VETRA: Password reveal toggle.

   Adds a "show/hide" eye-icon button to every type="password"
   input on the page a visitor can click to check what they typed
   before submitting. This is purely additive progressive
   enhancement: it wraps each password field in a small
   position:relative container and injects the button, nothing
   in the surrounding HTML has to change for it to work, since
   every existing CSS rule that targets these inputs (.input-wrap
   input, .field-group input, etc.) uses a descendant selector,
   which still matches once the input is one level deeper inside
   .password-field-wrap.

   Include this file on any page that has a type="password" field.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  // Eye icon (field is masked, click to reveal) vs. eye-with-slash
  // icon (field is revealed, click to mask again).
  const EYE_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  const EYE_OFF_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.6 18.6 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

  document.querySelectorAll('input[type="password"]').forEach((input) => {
    // Wrap just the input (not the whole field group) so the toggle
    // button can be positioned relative to it specifically.
    const wrap = document.createElement("div");
    wrap.className = "password-field-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.classList.add("has-password-toggle");

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "password-toggle-btn";
    toggleBtn.setAttribute("aria-label", "Show password");
    toggleBtn.innerHTML = EYE_ICON;

    toggleBtn.addEventListener("click", () => {
      const nowShowing = input.type === "password";
      input.type = nowShowing ? "text" : "password";
      toggleBtn.setAttribute("aria-label", nowShowing ? "Hide password" : "Show password");
      toggleBtn.innerHTML = nowShowing ? EYE_OFF_ICON : EYE_ICON;
    });

    wrap.appendChild(toggleBtn);
  });
});
