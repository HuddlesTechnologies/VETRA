/* =========================================================
   VETRA — SUPPORT BUTTON -> SMARTSUPP LIVE CHAT
   Every "Support" entry point on the site (sidebar link, bottom-nav
   item, header icon button) carries the .support-btn class. This
   opens the Smartsupp chat window via its documented command queue
   API (`smartsupp('chat:open')`), which is safe to call even before
   the widget script has finished loading — Smartsupp's loader snippet
   makes `smartsupp` a queuing function from the moment it's defined,
   so the call just waits and replays once the real widget is ready.
   ========================================================= */
document.addEventListener("click", function (e) {
  const btn = e.target.closest(".support-btn");
  if (!btn) return;

  e.preventDefault();

  if (typeof window.smartsupp === "function") {
    window.smartsupp("chat:open");
  }
});
