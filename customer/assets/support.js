/* =========================================================
   VETRA — SUPPORT BUTTON -> SMARTSUPP LIVE CHAT

   Every "Support" entry point on the site (sidebar link, bottom-nav
   item, header icon button) carries the .support-btn class.

   Visibility rule this file enforces: the Smartsupp widget (both its
   floating launcher bubble AND the chat window itself) stays fully
   hidden until a visitor deliberately clicks a .support-btn, and it
   goes back to fully hidden the moment they close the chat again —
   it should never just sit there as a floating bubble on its own.

   How that's done:
     1. assets/style.css hides #smartsupp-widget-container by default
        with `display: none !important`, and only un-hides it while
        <body> carries the "livechat-open" class (see the CSS rule
        right next to the old, since-removed "hide the whole widget
        forever" rule this file replaces the behavior of).
     2. Clicking .support-btn adds that class AND calls Smartsupp's
        documented `chat:open` command to open the chat window.
     3. Smartsupp's documented `chat.closed` event (fired when the
        visitor closes the chat via Smartsupp's own UI) removes the
        class again, which re-hides the widget via that same CSS rule.

   Both `smartsupp(...)` calls below are safe to make before the real
   widget script has finished loading: Smartsupp's loader snippet
   makes `smartsupp` a queuing function from the moment it's defined
   (see the inline snippet earlier on this page), so each call just
   waits and replays once the real widget connects.

   Note: `chat.closed` is Smartsupp's documented event name for "the
   visitor closed the chat window" as of this writing — if Smartsupp
   ever renames/changes it, this is the one line to update.
   ========================================================= */

// Open the chat: reveal the widget (via the CSS class) and ask
// Smartsupp to open its chat window.
document.addEventListener("click", function (e) {
  const btn = e.target.closest(".support-btn");
  if (!btn) return;

  e.preventDefault();

  if (typeof window.smartsupp === "function") {
    document.body.classList.add("livechat-open");
    window.smartsupp("chat:open");
  }
});

// Re-hide the widget whenever the visitor closes it from Smartsupp's
// own UI, so it doesn't linger on screen as a floating bubble after
// the first time it's opened.
if (typeof window.smartsupp === "function") {
  window.smartsupp("on", "chat.closed", function () {
    document.body.classList.remove("livechat-open");
  });
}
