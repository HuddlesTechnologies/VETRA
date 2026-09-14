/* =========================================================
   VETRA — SUPPORT BUTTON -> SMARTSUPP LIVE CHAT

   Every "Support" entry point on the site (sidebar link, bottom-nav
   item, header icon button) carries the .support-btn class.

   Visibility rule this file enforces: the Smartsupp widget (both its
   floating launcher bubble AND the chat window itself) stays fully
   hidden until a visitor deliberately clicks a .support-btn, and it
   goes back to fully hidden once they're done with the chat.

   How that's done:
     1. assets/style.css hides #smartsupp-widget-container by default
        with `display: none !important`, and only un-hides it while
        <body> carries the "livechat-open" class.
     2. Clicking .support-btn adds that class AND calls Smartsupp's
        documented `chat:open` command to open the chat window.
     3. Closing it back down is handled by OUR OWN small "✕ Close
        chat" button (injected below), not by detecting Smartsupp's
        native in-widget close click. That's deliberate: Smartsupp
        renders its chat UI inside a cross-origin iframe, so whether
        the visitor minimized/closed it is state that lives inside
        content this page is never allowed to read, no matter what
        event name or DOM/size-watching trick is used — two earlier
        attempts at detecting it that way (a `chat.closed` event
        listener, then polling the widget's on-screen size) both
        turned out not to work against the real widget for exactly
        this reason. Our own button sidesteps the problem entirely:
        clicking it calls Smartsupp's `chat:close` command and then
        reloads the page, which resets <body> to its default
        (no "livechat-open" class) and — because that's what actually
        hides the widget — guarantees it's gone, every time.

   Both `smartsupp(...)` calls are safe to make before the real widget
   script has finished loading: Smartsupp's loader snippet makes
   `smartsupp` a queuing function from the moment it's defined (see the
   inline snippet earlier on this page), so each call just waits and
   replays once the real widget connects.
   ========================================================= */

// Built once, lazily, the first time it's needed — see openLiveChat().
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
    // which is what actually re-hides the widget — see file header.
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
