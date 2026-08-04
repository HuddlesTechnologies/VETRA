document.addEventListener("click", function (e) {

    const btn = e.target.closest(".support-btn");

    if (!btn) return;

    e.preventDefault();

    // Find the Smartsupp launcher
    const launcher =
        document.querySelector("#smartsupp-widget-container") ||
        document.querySelector(".smartsupp-widget") ||
        document.querySelector('[class*="smartsupp"]');

    if (launcher) {
        launcher.click();
    }

});