/* =========================================================
   VETRA: Customer "file a report" (customer/orders.html).
   Opens the report modal from any order's "Report an issue"
   button, then submits it to the real POST /api/reports (see
   backend/src/routes/reports.routes.js). A buyer can only file
   against one of their own orders, enforced server-side.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("report-modal");
  const form = document.getElementById("report-form");
  const list = document.getElementById("order-list");
  if (!modal || !form || !list) return;

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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeCard) return;

    const orderId = activeCard.dataset.fullOrderId;
    const reason = `${reasonSelect.value}: ${detailsInput.value.trim()}`;
    const submitBtn = form.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    try {
      await VetraAPI.request("/reports", { method: "POST", role: "buyer", body: { orderId, reason } });

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
    } catch (err) {
      if (typeof CustomerUI !== "undefined") {
        CustomerUI.info({ title: "Couldn't file report", bodyHtml: err.message });
      }
    } finally {
      submitBtn.disabled = false;
    }
  });
});
