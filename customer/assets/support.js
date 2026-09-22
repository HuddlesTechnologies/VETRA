/* =========================================================
   VETRA: Support button, opens Smartsupp live chat.

   Every "Support" entry point on the site (sidebar link, bottom-nav
   item, header icon button) carries the .support-btn class.

   The Smartsupp widget (launcher bubble and chat window) stays fully
   hidden until a visitor clicks a .support-btn, and goes back to
   hidden once they're done. assets/style.css hides
   #smartsupp-widget-container by default and only shows it while
   <body> carries the "livechat-open" class; clicking .support-btn
   adds that class and calls Smartsupp's `chat:open` command.

   Closing is handled by our own "✕ Close chat" button (injected
   below), not by detecting Smartsupp's native in-widget close click.
   Smartsupp renders its chat UI in a cross-origin iframe, so whether
   the visitor closed it is state this page can never read, no matter
   the detection method, two earlier attempts (a `chat.closed`
   listener, then polling the widget's size) both failed for that
   reason. Our button sidesteps it: it calls `chat:close`, then
   reloads the page so <body> loses "livechat-open" on the fresh
   load, which is what actually hides the widget.

   Both `smartsupp(...)` calls are safe before the real widget script
   finishes loading. Smartsupp's loader snippet makes `smartsupp` a
   queuing function from the moment it's defined (see the inline
   snippet earlier on this page), so each call waits and replays once
   the widget connects.
   ========================================================= */

// Built once, lazily, the first time it's needed, see openLiveChat().
let closeLiveChatBtn = null;

function ensureCloseButton() {
  if (closeLiveChatBtn) return closeLiveChatBtn;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "livechat-close-btn";
  btn.setAttribute("aria-label", "Close live chat");
  btn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Close chat';

  btn.addEventListener("click", () => {
    if (typeof window.smartsupp === "function") {
      window.smartsupp("chat:close");
    }
    // Reload so <body> loses "livechat-open" on the fresh page load,
    // which is what actually re-hides the widget, see file header.
    window.location.reload();
  });

  document.body.appendChild(btn);
  closeLiveChatBtn = btn;
  return btn;
}

function openLiveChat() {
  if (typeof window.smartsupp !== "function") return;
  document.body.classList.add("livechat-open");
  window.smartsupp("chat:open");
  ensureCloseButton().hidden = false;
}

document.addEventListener("click", function (e) {
  const btn = e.target.closest(".support-btn");
  if (!btn) return;
  e.preventDefault();
  openLiveChat();
});
