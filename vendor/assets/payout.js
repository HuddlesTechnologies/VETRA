/* =========================================================
   VETRA — VENDOR PAYOUT ACCOUNT (vendor/earnings.html, real backend)
   Real GET/PUT /api/vendors/me/payout-account (backend/src/routes/
   vendors.routes.js) — replacing the old page-local mock that never
   persisted past a reload. The account number is encrypted at rest
   and the GET response only ever returns a masked version (see that
   route's own comment on why) — so editing an existing account always
   requires re-entering the full number; there's nothing to pre-fill
   it from client-side, by design.
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
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

  // The one source of truth for "what's actually saved" — separate from
  // the form's live input values, so Cancel can discard an in-progress
  // edit instead of committing it.
  let savedAccount = null;

  function renderSavedView() {
    document.getElementById("payout-view-bank").textContent = savedAccount.bankName;
    document.getElementById("payout-view-number").textContent = savedAccount.maskedAccountNumber;
    document.getElementById("payout-view-name").textContent = savedAccount.accountName;

    badge.textContent = "Account on file";
    badge.classList.remove("status-not-set");
    badge.classList.add("status-set");

    view.hidden = false;
    form.hidden = true;
  }

  function showForm() {
    // Bank/name carry over from what's saved so an edit isn't a blank
    // slate; the account number can't — the server never sends the
    // real number back, only a masked display copy, so it always has
    // to be re-typed to change it.
    if (savedAccount) {
      bankSelect.value = savedAccount.bankName;
      nameInput.value = savedAccount.accountName;
    }
    numberInput.value = "";
    numberInput.placeholder = savedAccount ? "Re-enter 10-digit NUBAN to confirm/change" : "10-digit NUBAN";
    numberInput.style.borderColor = "";
    view.hidden = true;
    form.hidden = false;
    cancelBtn.hidden = !savedAccount;
  }

  async function loadPayoutAccount() {
    try {
      const data = await VetraAPI.request("/vendors/me/payout-account", { method: "GET", role: "vendor" });
      if (data.isSet) {
        savedAccount = { bankName: data.bankName, maskedAccountNumber: data.maskedAccountNumber, accountName: data.accountName };
        renderSavedView();
      } else {
        savedAccount = null;
        showForm();
      }
    } catch (err) {
      VendorUI.info({ title: "Couldn't load payout account", bodyHtml: err.message });
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!/^\d{10}$/.test(numberInput.value.trim())) {
      numberInput.style.borderColor = "#e0475c";
      numberInput.focus();
      return;
    }
    numberInput.style.borderColor = "";

    submitBtn.disabled = true;
    try {
      const data = await VetraAPI.request("/vendors/me/payout-account", {
        method: "PUT",
        role: "vendor",
        body: {
          bankName: bankSelect.value,
          accountNumber: numberInput.value.trim(),
          accountName: nameInput.value.trim(),
        },
      });
      savedAccount = { bankName: data.bankName, maskedAccountNumber: data.maskedAccountNumber, accountName: data.accountName };
      renderSavedView();
    } catch (err) {
      VendorUI.info({ title: "Couldn't save payout account", bodyHtml: err.message });
    } finally {
      submitBtn.disabled = false;
    }
  });

  editBtn.addEventListener("click", showForm);

  cancelBtn.addEventListener("click", () => {
    if (savedAccount) renderSavedView();
  });

  await loadPayoutAccount();
});
