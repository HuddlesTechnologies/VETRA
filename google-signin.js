/* =========================================================
   VETRA — GOOGLE SIGN-IN (shared by signin.html and signup.html)

   Uses Google Identity Services' OAuth2 *token client*
   (google.accounts.oauth2.initTokenClient), not the One Tap/credential
   flow — the token client reliably opens a real popup from a click on
   this site's own existing custom-styled ".google-btn", where the
   credential flow needs Google's own rendered button to do that
   reliably. Returns an access token, verified server-side by
   POST /api/auth/google (see backend/src/utils/googleAuth.js) against
   Google's userinfo endpoint — never needs the Client Secret.

   Google only ever supplies name/email/photo, never a phone number or
   delivery address — so when the backend reports
   needsProfileCompletion: true (a brand-new account, or an existing
   one still missing those fields), this shows a small modal asking for
   exactly what's missing before continuing into the app. Built once
   and reused by both signin.html and signup.html rather than
   duplicating the modal markup in each page's HTML.
   ========================================================= */

const GOOGLE_CLIENT_ID = "984251848807-ld23n7s51al5v6ilhbff76lbj8vqi689.apps.googleusercontent.com";

// Same fixed list the backend validates against (backend/src/utils/
// nigerianStates.js) — state is required for every account, same as
// phone/address, so the "complete your profile" modal below needs it too.
const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
  "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT (Abuja)",
];

const VetraGoogleSignIn = (() => {
  let tokenClient = null;
  let pendingRole = null;
  let pendingUser = null;

  function getActiveRole() {
    const active = document.querySelector(".toggle button.active");
    const mode = active ? active.dataset.mode : "buyer";
    return mode === "Vendor" ? "vendor" : "buyer";
  }

  function dashboardUrlFor(role) {
    return role === "vendor" ? "vendor/dashboard.html" : "customer/dashboard.html";
  }

  function buildModal() {
    if (document.getElementById("gsi-complete-modal")) return;
    const modal = document.createElement("div");
    modal.className = "gsi-modal-overlay";
    modal.id = "gsi-complete-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="gsi-modal-panel">
        <h2>Just a few more details</h2>
        <p class="gsi-sub" id="gsi-sub">Google signed you in, but we still need this to actually deliver your orders.</p>
        <p class="gsi-modal-error" id="gsi-error" hidden></p>
        <div class="field" id="gsi-field-storeName" hidden>
          <label for="gsi-storeName">Business name</label>
          <div class="input-wrap"><input id="gsi-storeName" type="text" placeholder="Business name" /></div>
        </div>
        <div class="field">
          <label for="gsi-phone">Phone number</label>
          <div class="input-wrap">
            <span class="phone-prefix">+234</span>
            <input id="gsi-phone" type="tel" placeholder="e.g. 08100000000" />
          </div>
        </div>
        <div class="field">
          <label for="gsi-address" id="gsi-address-label">Delivery address</label>
          <div class="input-wrap"><input id="gsi-address" type="text" placeholder="Enter your address" /></div>
        </div>
        <div class="field">
          <label for="gsi-state">State</label>
          <div class="input-wrap">
            <select id="gsi-state" required>
              <option value="" disabled selected>Select your state</option>
              ${NIGERIAN_STATES.map((s) => `<option value="${s}">${s}</option>`).join("")}
            </select>
          </div>
        </div>
        <button class="continue-btn" type="button" id="gsi-submit-btn">Continue <span class="btn-arrow">→</span></button>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("gsi-submit-btn").addEventListener("click", submitProfile);
  }

  function openModal(role) {
    buildModal();
    document.getElementById("gsi-field-storeName").hidden = role !== "vendor";
    document.getElementById("gsi-address-label").textContent =
      role === "vendor" ? "Business address" : "Delivery address";
    document.getElementById("gsi-error").hidden = true;
    document.getElementById("gsi-storeName").value = "";
    document.getElementById("gsi-phone").value = "";
    document.getElementById("gsi-address").value = "";
    document.getElementById("gsi-state").value = "";
    document.getElementById("gsi-complete-modal").hidden = false;
  }

  function closeModal() {
    const modal = document.getElementById("gsi-complete-modal");
    if (modal) modal.hidden = true;
  }

  function showError(message) {
    const el = document.getElementById("gsi-error");
    el.textContent = message;
    el.hidden = false;
  }

  async function submitProfile() {
    const role = pendingRole;
    const phone = document.getElementById("gsi-phone").value.trim();
    const address = document.getElementById("gsi-address").value.trim();
    const state = document.getElementById("gsi-state").value;
    const storeName = role === "vendor" ? document.getElementById("gsi-storeName").value.trim() : null;

    if (!phone || !address || !state || (role === "vendor" && !storeName)) {
      showError("Please fill in every field before continuing.");
      return;
    }

    const btn = document.getElementById("gsi-submit-btn");
    btn.disabled = true;
    try {
      const body = { phone, address, state };
      if (role === "vendor") body.storeName = storeName;
      await VetraAPI.request("/auth/me", { method: "PATCH", role, body });
      closeModal();
      window.location.href = dashboardUrlFor(role);
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function handleAccessToken(tokenResponse, role) {
    if (!tokenResponse || tokenResponse.error) {
      // User closed the Google popup or denied access — not an error
      // worth surfacing, same as clicking away from any other picker.
      return;
    }
    try {
      const data = await VetraAPI.request("/auth/google", {
        method: "POST",
        body: { accessToken: tokenResponse.access_token, role },
      });
      VetraAPI.setSession(role, data.token, data.user);
      if (data.needsProfileCompletion) {
        pendingRole = role;
        pendingUser = data.user;
        openModal(role);
      } else {
        window.location.href = dashboardUrlFor(role);
      }
    } catch (err) {
      // Reuses whichever inline error <p> the page's own email-flow
      // script already has (#signin-error / #signup-error) instead of a
      // jarring native alert(), matching the rest of this page's error UX.
      const errorEl = document.getElementById("signin-error") || document.getElementById("signup-error");
      if (errorEl) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      } else {
        alert(err.message);
      }
    }
  }

  function init() {
    const btn = document.querySelector(".google-btn");
    if (!btn) return;

    btn.addEventListener("click", () => {
      if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) {
        alert("Google Sign-In is still loading — try again in a moment.");
        return;
      }
      const role = getActiveRole();
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: "openid email profile",
          callback: (tokenResponse) => handleAccessToken(tokenResponse, getActiveRole()),
        });
      }
      tokenClient.requestAccessToken();
    });
  }

  document.addEventListener("DOMContentLoaded", init);

  return { init };
})();
