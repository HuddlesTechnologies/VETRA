/* =========================================================
   VETRA: Customer shared UI (confirm modal).

   CustomerUI.confirm()/.info()/.photoPreview() now delegate to
   shared-ui.js (VetraModal), the same implementation admin and
   vendor use, instead of a third reimplementation. Every existing
   call site keeps calling CustomerUI.confirm(...)/.info(...)/
   .photoPreview(...) exactly as before, including the onCancel
   callback (guest-access popups on orders.html/settings.html).
   ========================================================= */

const CustomerUI = {
  confirm: VetraModal.confirm,
  info: VetraModal.info,
  photoPreview: VetraModal.photoPreview,
};
