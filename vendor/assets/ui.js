/* =========================================================
   VETRA: Vendor shared UI (confirm modal).

   VendorUI.confirm()/.info()/.photoPreview() now delegate to
   shared-ui.js (VetraModal), the same implementation admin and
   customer use, instead of a third reimplementation. Every existing
   call site keeps calling VendorUI.confirm(...)/.info(...)/
   .photoPreview(...) exactly as before.
   ========================================================= */

const VendorUI = {
  confirm: VetraModal.confirm,
  info: VetraModal.info,
  photoPreview: VetraModal.photoPreview,
};
