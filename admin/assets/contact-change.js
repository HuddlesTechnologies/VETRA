/* =========================================================
   VETRA: Admin contact info change (email/phone).
   Shared by admin/customer-detail.html and admin/vendor-detail.html's
   renderActions(), lets a Super Admin/Moderator change another
   user's contact info (locked-out account, typo'd signup email,
   lost-device phone update), something PATCH /api/auth/me can't do
   since it only ever edits the CALLER's own profile. Backed by
   backend/src/routes/admin.routes.js's requestEmailChange/
   verifyEmailChange/updatePhone.

   Email changes are two steps (send code to the new address, then
   enter it) since the OTP has to be verified before the change takes
   effect; phone changes are one step with a required reason instead,
   since there's no SMS infrastructure to OTP-gate a phone number the
   same way.

   Builds its own modal markup on first use (this content, new-email/
   new-phone/reason/code fields, a two-step flow, is genuinely unique,
   not something shared-ui.js's generic confirm()/info() shape fits),
   but reuses shared-ui.js's VetraModal.wireDismissal() for the actual
   cancel/✕/overlay-click/Escape behavior rather than reimplementing
   that too. Same .modal-overlay/.modal-panel/.form-group classes every
   other modal in the app uses, so it matches with no new CSS.
   ========================================================= */

const VetraContactChange = (() => {
  let els = null;

  function mount() {
    if (els) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="modal-overlay" id="contact-change-modal" hidden>
        <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="cc-modal-title">
          <div class="modal-header">
            <h2 id="cc-modal-title">Change contact info</h2>
            <button type="button" class="modal-close-btn" id="cc-modal-close" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <p id="cc-modal-intro" style="margin: 0 0 14px; font-size: 13px; color: var(--muted);"></p>

            <div class="form-group full" id="cc-field-email-wrap" hidden>
              <label class="form-label" for="cc-field-email">New email address</label>
              <input class="form-input" type="email" id="cc-field-email" placeholder="name@example.com" />
            </div>

            <div class="form-group full" id="cc-field-phone-wrap" hidden>
              <label class="form-label" for="cc-field-phone">New phone number</label>
              <input class="form-input" type="tel" id="cc-field-phone" placeholder="080..." />
            </div>

            <div class="form-group full" id="cc-field-reason-wrap" hidden>
              <label class="form-label" for="cc-field-reason">Reason <span class="form-hint">(required, visible in the activity log)</span></label>
              <textarea class="form-textarea" id="cc-field-reason" placeholder="e.g. Lost device, customer confirmed by phone"></textarea>
            </div>

            <div class="form-group full" id="cc-field-code-wrap" hidden>
              <label class="form-label" for="cc-field-code">Verification code</label>
              <input class="form-input" type="text" inputmode="numeric" maxlength="6" id="cc-field-code" placeholder="6-digit code" />
            </div>

            <p id="cc-modal-error" style="display:none; margin: 0 0 14px; font-size: 12.5px; font-weight: 600; color: #e0475c;"></p>

            <div class="form-actions">
              <button type="button" class="btn btn-cancel" id="cc-modal-cancel">Cancel</button>
              <button type="button" class="btn btn-save" id="cc-modal-submit">Continue</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap.firstElementChild);

    els = {
      overlay: document.getElementById("contact-change-modal"),
      title: document.getElementById("cc-modal-title"),
      intro: document.getElementById("cc-modal-intro"),
      emailWrap: document.getElementById("cc-field-email-wrap"),
      email: document.getElementById("cc-field-email"),
      phoneWrap: document.getElementById("cc-field-phone-wrap"),
      phone: document.getElementById("cc-field-phone"),
      reasonWrap: document.getElementById("cc-field-reason-wrap"),
      reason: document.getElementById("cc-field-reason"),
      codeWrap: document.getElementById("cc-field-code-wrap"),
      code: document.getElementById("cc-field-code"),
      error: document.getElementById("cc-modal-error"),
      cancelBtn: document.getElementById("cc-modal-cancel"),
      closeBtn: document.getElementById("cc-modal-close"),
      submitBtn: document.getElementById("cc-modal-submit"),
    };

    // Same cancel/✕/overlay-click/Escape wiring every modal in the app
    // needs, shared-ui.js's VetraModal owns one implementation of it
    // now instead of this being a fourth copy.
    VetraModal.wireDismissal({
      overlay: els.overlay,
      cancelBtn: els.cancelBtn,
      closeBtn: els.closeBtn,
      onDismiss: close,
    });
  }

  function close() {
    if (els) els.overlay.hidden = true;
  }

  function showError(message) {
    els.error.textContent = message || "";
    els.error.style.display = message ? "block" : "none";
  }

  function resetFields() {
    els.emailWrap.hidden = true;
    els.phoneWrap.hidden = true;
    els.reasonWrap.hidden = true;
    els.codeWrap.hidden = true;
    showError("");
  }

  /**
   * @param {Object} opts
   * @param {string} opts.endpointBase - "/admin/customers" or "/admin/vendors"
   * @param {string} opts.id - target user id
   * @param {string} opts.name - target's display name, for the intro copy
   * @param {string} opts.currentEmail
   * @param {(newEmail: string) => void} opts.onDone - called after the change is verified and saved
   */
  function openEmailChangeModal(opts) {
    mount();
    resetFields();
    els.title.textContent = "Change email";
    els.intro.textContent = `${opts.name}'s current email is ${opts.currentEmail}. A verification code will be sent to the new address before the change takes effect.`;
    els.emailWrap.hidden = false;
    els.email.value = "";
    els.submitBtn.textContent = "Send code";
    els.overlay.hidden = false;
    els.email.focus();

    let pendingNewEmail = null;

    els.submitBtn.onclick = async () => {
      showError("");

      if (!pendingNewEmail) {
        const newEmail = els.email.value.trim();
        if (!newEmail) return showError("Enter a new email address.");
        els.submitBtn.disabled = true;
        try {
          await VetraAPI.request(`${opts.endpointBase}/${opts.id}/email`, {
            method: "POST", role: "admin", body: { newEmail },
          });
          pendingNewEmail = newEmail;
          els.emailWrap.hidden = true;
          els.intro.textContent = `Enter the 6-digit code sent to ${newEmail}.`;
          els.codeWrap.hidden = false;
          els.code.value = "";
          els.submitBtn.textContent = "Verify & save";
          els.code.focus();
        } catch (err) {
          showError(err.message);
        } finally {
          els.submitBtn.disabled = false;
        }
        return;
      }

      const code = els.code.value.trim();
      if (!code) return showError("Enter the verification code.");
      els.submitBtn.disabled = true;
      try {
        const result = await VetraAPI.request(`${opts.endpointBase}/${opts.id}/email/verify`, {
          method: "POST", role: "admin", body: { code },
        });
        close();
        if (opts.onDone) opts.onDone(result.email);
      } catch (err) {
        showError(err.message);
      } finally {
        els.submitBtn.disabled = false;
      }
    };
  }

  /**
   * @param {Object} opts
   * @param {string} opts.endpointBase - "/admin/customers" or "/admin/vendors"
   * @param {string} opts.id
   * @param {string} opts.name
   * @param {string} opts.currentPhone
   * @param {(newPhone: string) => void} opts.onDone
   */
  function openPhoneChangeModal(opts) {
    mount();
    resetFields();
    els.title.textContent = "Change phone number";
    els.intro.textContent = `${opts.name}'s current phone is ${opts.currentPhone || "not set"}. This is a direct change, for account-recovery/extreme cases, there's no verification step for a phone number.`;
    els.phoneWrap.hidden = false;
    els.phone.value = "";
    els.reasonWrap.hidden = false;
    els.reason.value = "";
    els.submitBtn.textContent = "Save";
    els.overlay.hidden = false;
    els.phone.focus();

    els.submitBtn.onclick = async () => {
      showError("");
      const phone = els.phone.value.trim();
      const reason = els.reason.value.trim();
      if (!phone) return showError("Enter a new phone number.");
      if (!reason) return showError("A reason is required.");
      els.submitBtn.disabled = true;
      try {
        await VetraAPI.request(`${opts.endpointBase}/${opts.id}/phone`, {
          method: "PATCH", role: "admin", body: { phone, reason },
        });
        close();
        if (opts.onDone) opts.onDone(phone);
      } catch (err) {
        showError(err.message);
      } finally {
        els.submitBtn.disabled = false;
      }
    };
  }

  return { openEmailChangeModal, openPhoneChangeModal };
})();
