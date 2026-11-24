/* =========================================================
   VETRA: Vendor notifications (vendor/notifications.html).
   The list itself, read/unread states, and "Mark all read" live in
   ../notifications-ui.js, shared with the customer app.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  VetraNotifications.mount({
    role: "vendor",
    emptyClass: "vendor-products-empty",
    onBadgeChange: () => { if (typeof VetraUI !== "undefined") VetraUI.updateNotificationBadge(); },
  });
});
