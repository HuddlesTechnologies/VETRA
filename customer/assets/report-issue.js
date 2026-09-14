/* =========================================================
   VETRA — CUSTOMER "FILE A REPORT" (customer/orders.html)
   Opens the report modal from any order's "Report an issue"
   button, then hands the filled-in form to VetraAdmin.addReport()
   (loaded from ../admin/assets/data.js — see the <script> comment
   in orders.html for why this page reaches into the admin data
   module directly instead of staying a page-local mock like the
   rest of this app). A real backend replaces this with a
   POST /api/orders/:id/report call instead — see BACKEND_GUIDE.md.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("report-modal");
  const form = document.getElementById("report-form");
  const list = document.getElementById("order-list");
  if (!modal || !form || !list) return;

  // Stand-in for "the signed-in buyer" — matches the mock profile used
  // on customer/settings.html, since this app has no real session either.
  const CURRENT_BUYER = "Amaka Obi";

  const orderIdEl = document.getElementById("report-order-id");
  const vendorNameEl = document.getElementById("report-vendor-name");
  const reasonSelect = document.getElementById("report-reason");
  const detailsInput = document.getElementById("report-details");
  const closeBtn = document.getElementById("report-modal-close");
  const cancelBtn = document.getElementById("report-cancel-btn");

  let activeCard = null;

  function openModal(card) {
    activeCard = card;
    orderIdEl.textContent = card.dataset.orderId || "—";
    vendorNameEl.textContent = card.dataset.vendorName || "—";
    form.reset();
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    reasonSelect.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    activeCard = null;
  }

  list.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="report-issue"]');
    if (!btn) return;
    const card = btn.closest(".order-card");
    if (card) openModal(card);
  });

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeCard) return;

    const vendorId = activeCard.dataset.vendorId;
    const vendorName = activeCard.dataset.vendorName;
    const orderId = activeCard.dataset.orderId;
    const reason = `${reasonSelect.value} (${orderId}): ${detailsInput.value.trim()}`;

    if (typeof VetraAdmin !== "undefined") {
      VetraAdmin.addReport({
        type: "vendor",
        targetId: vendorId,
        targetName: vendorName,
        reporter: CURRENT_BUYER,
        reason,
      });
    }

    // Swap the button out for a filed-state tag so this order can't be
    // reported twice, and to make the action feel like it actually did
    // something rather than just closing a modal.
    const actionBtn = activeCard.querySelector('[data-action="report-issue"]');
    if (actionBtn) {
      const tag = document.createElement("span");
      tag.className = "report-filed-tag";
      tag.textContent = "Report filed";
      actionBtn.replaceWith(tag);
    }

    closeModal();
  });
});
