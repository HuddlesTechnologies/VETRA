/* =========================================================
   VETRA — VENDOR PAYOUT ACCOUNT (vendor/earnings.html)
   Lets a vendor set the bank account their weekly payouts go to
   — closes a gap where this page already showed payout history
   captioned "Payout to bank account" with nothing anywhere to
   actually set one. Page-local mock like the rest of this app:
   nothing here persists past a reload. A real backend replaces
   this with a PUT /api/vendor/payout-account call (see
   BACKEND_GUIDE.md) — note a real version must never store or
   display a full account number after entry; this demo version
   does, for the sake of showing the saved-state UI at all.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("payout-account-form");
  if (!form) return;

  const badge = document.getElementById("payout-status-badge");
  const view = document.getElementById("payout-account-view");
  const bankSelect = document.getElementById("payout-bank");
  const numberInput = document.getElementById("payout-account-number");
  const nameInput = document.getElementById("payout-account-name");
  const submitBtn = document.getElementById("payout-submit-btn");
  const cancelBtn = document.getElementById("payout-cancel-btn");
  const editBtn = document.getElementById("payout-edit-btn");

  function maskAccountNumber(number) {
    return `•••• ${number.slice(-4)}`;
  }

  // The one source of truth for "what's actually saved" — separate from
  // the form's live input values, so Cancel can discard an in-progress
  // edit instead of committing it. (Bug found by a QA pass: this used to
  // not exist, so showSavedView() re-read the live form every time,
  // which meant Cancel behaved as an unvalidated second submit button.)
  let savedAccount = null;

  function renderSavedView() {
    document.getElementById("payout-view-bank").textContent = savedAccount.bank;
    document.getElementById("payout-view-number").textContent = maskAccountNumber(savedAccount.number);
    document.getElementById("payout-view-name").textContent = savedAccount.name;

    badge.textContent = "Account on file";
    badge.classList.remove("status-not-set");
    badge.classList.add("status-set");

    view.hidden = false;
    form.hidden = true;
  }

  function showForm() {
    // Editing starts from whatever's actually saved, not whatever was
    // left in the inputs from a previous cancelled edit.
    if (savedAccount) {
      bankSelect.value = savedAccount.bank;
      numberInput.value = savedAccount.number;
      nameInput.value = savedAccount.name;
      numberInput.style.borderColor = "";
    }
    view.hidden = true;
    form.hidden = false;
    cancelBtn.hidden = !savedAccount;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    if (!/^\d{10}$/.test(numberInput.value.trim())) {
      numberInput.style.borderColor = "#e0475c";
      numberInput.focus();
      return;
    }
    numberInput.style.borderColor = "";

    savedAccount = {
      bank: bankSelect.value,
      number: numberInput.value.trim(),
      name: nameInput.value.trim(),
    };
    renderSavedView();
  });

  editBtn.addEventListener("click", showForm);

  cancelBtn.addEventListener("click", () => {
    // Discard whatever's in the form — re-render from savedAccount, not
    // from the (possibly invalid, possibly edited) live input values.
    if (savedAccount) renderSavedView();
  });
});
