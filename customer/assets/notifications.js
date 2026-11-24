/* =========================================================
   VETRA: Customer notifications (customer/notifications.html).
   The list itself, read/unread states, and "Mark all read" live in
   ../notifications-ui.js, shared with the vendor app.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  VetraNotifications.mount({
    role: "buyer",
    emptyClass: "products-empty-state",
    onBadgeChange: () => { if (typeof Vetra !== "undefined") Vetra.updateNotificationBadge(); },
  });
});
