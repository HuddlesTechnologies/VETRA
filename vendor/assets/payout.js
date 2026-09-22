/* =========================================================
   VETRA: Vendor payout account (vendor/earnings.html, real backend).
   Real GET/PUT /api/vendors/me/payout-account (backend/src/routes/
   vendors.routes.js), replacing the old page-local mock that never
   persisted past a reload. The account number is encrypted at rest
   and the GET response only ever returns a masked version (see that
   route's own comment on why), so editing an existing account always
   requires re-entering the full number; there's nothing to pre-fill
   it from client-side, by design.

   Bank + account name are no longer hand-typed: the bank field is a
   searchable list backed by Paystack's bank directory
   (GET /me/payout-account/banks) and the account name is resolved
   live against the bank (GET /me/payout-account/resolve) the moment
   a real bank + 10-digit NUBAN are both present, the same "verify
   before you trust it" call PUT itself makes server-side before
   saving. There's nothing left for a vendor to type incorrectly (or
   spoof) in the name field, it's just a confirmation of what comes
   back.
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("payout-account-form");
  if (!form) return;

  const badge = document.getElementById("payout-status-badge");
  const view = document.getElementById("payout-account-view");
  const bankInput = document.getElementById("payout-bank");
  const bankResults = document.getElementById("payout-bank-results");
  const numberInput = document.getElementById("payout-account-number");
  const resolvedNameEl = document.getElementById("payout-resolved-name");
  const submitBtn = document.getElementById("payout-submit-btn");
  const cancelBtn = document.getElementById("payout-cancel-btn");
  const editBtn = document.getElementById("payout-edit-btn");

  // name (as shown in the dropdown/typed) -> Paystack bank code. Typing
  // or clicking a result only ever puts plain text in the box, never the
  // code, so this is how "GTBank" in the box turns into what the API
  // needs. banksList is the same data as a plain array, for the dropdown
  // to filter/render from.
  let banksByName = new Map();
  let banksList = [];
  // Set once resolution succeeds, for exactly the bank+number pair it
  // was resolved for, cleared the moment either input changes again,
  // so a stale name can never be submitted for a since-edited number.
  let resolvedFor = null; // { bankCode, accountNumber, accountName }

  // The one source of truth for "what's actually saved", separate from
  // the form's live input values, so Cancel can discard an in-progress
  // edit instead of committing it.
  let savedAccount = null;

  async function loadBanks() {
    try {
      const banks = await VetraAPI.request("/vendors/me/payout-account/banks", { method: "GET", role: "vendor" });
      banksByName = new Map(banks.map((b) => [b.name.toLowerCase(), b]));
      banksList = banks;
    } catch (err) {
      // The form still works to look at (just can't resolve/save),
      // surfaced once, not on every keystroke that follows.
      VendorUI.info({ title: "Couldn't load bank list", bodyHtml: err.message });
    }
  }

  function matchedBank() {
    return banksByName.get(bankInput.value.trim().toLowerCase()) || null;
  }

  // ---- Custom search dropdown (see the CSS comment on .bank-search for
  // why this isn't a native <input list>/<datalist>) ----
  let activeResultIndex = -1;

  function closeBankResults() {
    bankResults.hidden = true;
    bankResults.innerHTML = "";
    activeResultIndex = -1;
    bankInput.setAttribute("aria-expanded", "false");
  }

  function renderBankResults() {
    const query = bankInput.value.trim().toLowerCase();
    const matches = (query ? banksList.filter((b) => b.name.toLowerCase().includes(query)) : banksList).slice(0, 40);

    if (!banksList.length) {
      closeBankResults();
      return;
    }
    if (!matches.length) {
      bankResults.innerHTML = `<p class="bank-search-empty">No matching banks.</p>`;
      bankResults.hidden = false;
      bankInput.setAttribute("aria-expanded", "true");
      activeResultIndex = -1;
      return;
    }

    bankResults.innerHTML = matches
      .map((b, i) => `<button type="button" class="bank-search-result" data-index="${i}" data-name="${VetraAPI.escapeHtml(b.name)}">${VetraAPI.escapeHtml(b.name)}</button>`)
      .join("");
    bankResults.hidden = false;
    bankInput.setAttribute("aria-expanded", "true");
    activeResultIndex = -1;

    bankResults.querySelectorAll(".bank-search-result").forEach((btn) => {
      // mousedown (not click) fires before the input's blur handler
      // closes the dropdown, so a tap/click on a result always registers.
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => selectBank(btn.dataset.name));
    });
  }

  function selectBank(name) {
    bankInput.value = name;
    closeBankResults();
    scheduleResolve();
  }

  function highlightResult(index) {
    const items = bankResults.querySelectorAll(".bank-search-result");
    items.forEach((el) => el.classList.remove("active"));
    if (items[index]) {
      items[index].classList.add("active");
      items[index].scrollIntoView({ block: "nearest" });
    }
    activeResultIndex = index;
  }

  bankInput.addEventListener("focus", renderBankResults);
  bankInput.addEventListener("keydown", (e) => {
    const items = bankResults.hidden ? [] : bankResults.querySelectorAll(".bank-search-result");
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      highlightResult(Math.min(activeResultIndex + 1, items.length - 1));
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      highlightResult(Math.max(activeResultIndex - 1, 0));
    } else if (e.key === "Enter" && activeResultIndex >= 0 && items[activeResultIndex]) {
      e.preventDefault();
      selectBank(items[activeResultIndex].dataset.name);
    } else if (e.key === "Escape") {
      closeBankResults();
    }
  });
  // A blur means focus left the input, delayed so a tap on a result
  // (which blurs the input just before its own click fires) doesn't
  // close the dropdown before that click is handled.
  bankInput.addEventListener("blur", () => setTimeout(closeBankResults, 150));

  function setResolvedState(state, text) {
    resolvedNameEl.textContent = text;
    resolvedNameEl.style.color = state === "error" ? "#e0475c" : state === "verified" ? "" : "var(--muted)";
    submitBtn.disabled = state !== "verified";
  }

  let resolveTimer = null;
  function scheduleResolve() {
    resolvedFor = null;
    clearTimeout(resolveTimer);

    const bank = matchedBank();
    const accountNumber = numberInput.value.trim();

    if (!bank) {
      setResolvedState("idle", "Select a bank from the list.");
      return;
    }
    if (!/^\d{10}$/.test(accountNumber)) {
      setResolvedState("idle", "Enter the 10-digit account number to verify.");
      return;
    }

    setResolvedState("idle", "Verifying with your bank…");
    resolveTimer = setTimeout(async () => {
      try {
        const data = await VetraAPI.request(
          `/vendors/me/payout-account/resolve?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bank.code)}`,
          { method: "GET", role: "vendor" }
        );
        // Inputs may have changed while the request was in flight,
        // only trust this result if they still match what was sent.
        if (matchedBank()?.code !== bank.code || numberInput.value.trim() !== accountNumber) return;
        resolvedFor = { bankCode: bank.code, accountNumber, accountName: data.accountName };
        setResolvedState("verified", data.accountName);
      } catch (err) {
        if (matchedBank()?.code !== bank.code || numberInput.value.trim() !== accountNumber) return;
        setResolvedState("error", err.message);
      }
    }, 500);
  }

  bankInput.addEventListener("input", () => {
    renderBankResults();
    scheduleResolve();
  });
  numberInput.addEventListener("input", scheduleResolve);

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
    // Bank carries over from what's saved so an edit isn't a blank
    // slate; the account number can't, the server never sends the
    // real number back, only a masked display copy, so it always has
    // to be re-typed to change it. The name is never carried over
    // either way, it's re-resolved from scratch, same as a first save.
    bankInput.value = savedAccount ? savedAccount.bankName : "";
    numberInput.value = "";
    numberInput.placeholder = savedAccount ? "Re-enter 10-digit NUBAN to confirm/change" : "10-digit NUBAN";
    numberInput.style.borderColor = "";
    resolvedFor = null;
    setResolvedState("idle", "Select a bank and enter the account number to verify.");
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

    const bank = matchedBank();
    if (!bank) {
      bankInput.style.borderColor = "#e0475c";
      bankInput.focus();
      return;
    }
    bankInput.style.borderColor = "";

    if (!/^\d{10}$/.test(numberInput.value.trim())) {
      numberInput.style.borderColor = "#e0475c";
      numberInput.focus();
      return;
    }
    numberInput.style.borderColor = "";

    // Resolution is what unlocks the submit button in the first place
    // (see setResolvedState), but re-check here too, a bank/number
    // edit after resolving clears resolvedFor, and this guards the
    // (disabled-button-bypassing) Enter-key submit path too.
    if (!resolvedFor || resolvedFor.bankCode !== bank.code || resolvedFor.accountNumber !== numberInput.value.trim()) {
      setResolvedState("error", "Verify the account details before saving.");
      return;
    }

    submitBtn.disabled = true;
    try {
      const data = await VetraAPI.request("/vendors/me/payout-account", {
        method: "PUT",
        role: "vendor",
        body: {
          bankName: bank.name,
          bankCode: bank.code,
          accountNumber: numberInput.value.trim(),
        },
      });
      savedAccount = { bankName: data.bankName, maskedAccountNumber: data.maskedAccountNumber, accountName: data.accountName };
      renderSavedView();
    } catch (err) {
      VendorUI.info({ title: "Couldn't save payout account", bodyHtml: err.message });
      submitBtn.disabled = false;
    }
  });

  editBtn.addEventListener("click", showForm);

  cancelBtn.addEventListener("click", () => {
    if (savedAccount) renderSavedView();
  });

  await loadBanks();
  await loadPayoutAccount();
});
