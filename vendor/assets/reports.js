/* =========================================================
   VETRA — VENDOR REPORTS & DISPUTES (vendor/orders.html)
   Read-only view of reports filed against this store — the
   companion side of admin/reports.html, which is where an
   admin actually resolves or dismisses a report. A vendor can
   only respond with evidence within the 48-hour window called
   out on vendor-protection.html; there's no backend, so
   "submitting" evidence just marks the card as responded to.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("evidence-modal");
  const form = document.getElementById("evidence-form");
  const list = document.getElementById("report-list");
  if (!modal || !form || !list) return;

  const textInput = document.getElementById("evidence-text");
  const closeBtn = document.getElementById("evidence-modal-close");
  const cancelBtn = document.getElementById("evidence-cancel-btn");

  let activeCard = null;

  function openModal(card) {
    activeCard = card;
    textInput.value = "";
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    textInput.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    activeCard = null;
  }

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='evidence']");
    if (!btn) return;
    const card = btn.closest(".report-card");
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

    // Replace the "Submit evidence" button with a sent-state tag so the
    // vendor can see the response was recorded, and drop the meta row's
    // response-deadline note since it's no longer relevant.
    const actions = activeCard.querySelector(".report-actions");
    if (actions) {
      actions.innerHTML = `<span class="badge dismissed evidence-sent-tag">Evidence submitted — awaiting review</span>`;
    }

    closeModal();
  });
});
