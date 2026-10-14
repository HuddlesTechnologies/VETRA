/* =========================================================
   VETRA: Rider app (rider/index.html).

   Everything a rider does on a job, against /api/delivery/rider
   (backend/src/routes/delivery.routes.js):

     assigned          -> Accept / Decline (offer expires after 20 min)
     accepted          -> go to the vendor, type the vendor's 4-digit
                          pickup code -> picked_up
     picked_up         -> Start delivery -> out_for_delivery
     out_for_delivery  -> type the buyer's 6-digit code (optional
                          photo) -> delivered, or "Couldn't deliver"
     returning         -> take it back, the vendor confirms receipt

   While on duty with a live job, the device's position is sent every
   30 seconds so the buyer's tracking panel can show it on a map. Jobs
   are re-polled every 20 seconds to pick up new offers; there's no
   push channel in this backend.
   ========================================================= */

const RIDER_POLL_MS = 20000;
const LOCATION_SEND_MS = 30000;
const OFFER_TIMEOUT_MIN = 20;
// The rider's own view of each step, rather than the buyer-facing
// DELIVERY_STATUS_LABEL ("Rider being assigned" means nothing to the rider).
const RIDER_STATUS_LABEL = {
  assigned: "New job offer",
  accepted: "Go to the vendor",
  picked_up: "Parcel collected",
  out_for_delivery: "Delivering to buyer",
  returning: "Return to vendor",
};

const RiderApp = (() => {
  let me = null;
  let jobs = [];
  let watchId = null;
  let lastSentAt = 0;
  let lastPosition = null;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => VetraAPI.escapeHtml(v ?? "");
  const api = (path, opts = {}) => VetraAPI.request(path, { role: "rider", ...opts });

  function mapsLink(address, state) {
    const q = [address, state, "Nigeria"].filter(Boolean).join(", ");
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
  }

  function telLink(phone, label) {
    return phone ? `<a class="rider-btn small" href="tel:${encodeURIComponent(phone)}">${label}</a>` : "";
  }

  function minutesLeft(assignedAt) {
    const elapsed = (Date.now() - new Date(assignedAt).getTime()) / 60000;
    return Math.max(0, Math.ceil(OFFER_TIMEOUT_MIN - elapsed));
  }

  // ---------- Rendering ----------

  function renderMe() {
    $("rider-name").textContent = me.name || "";
    const on = me.rider_on_duty;
    const sw = $("rider-duty-switch");
    sw.classList.toggle("on", on);
    sw.setAttribute("aria-checked", String(on));
    $("rider-duty-label").textContent = on ? "On duty" : "Off duty";
    $("rider-duty-hint").textContent = on
      ? `Receiving jobs in ${me.state || "your state"}.`
      : "Go on duty to receive delivery jobs in your area.";
    const zone = $("rider-zone");
    if (!zone.options.length) zone.innerHTML = stateOptionsMarkup(me.state);
    if (document.activeElement !== zone) zone.value = me.state || "";
    // Changing area is refused server-side while any job is held; disable
    // it here too so the rider sees why before trying.
    zone.disabled = jobs.length > 0;
    zone.title = zone.disabled ? "Finish or decline your current jobs to change area." : "";
    $("stat-today").textContent = formatNaira(me.stats.todayEarnings);
    $("stat-unpaid").textContent = formatNaira(me.stats.unpaidEarnings);
    $("stat-delivered").textContent = me.stats.delivered.toLocaleString();
  }

  function stopBlock(kind, j) {
    if (kind === "pickup") {
      return `
        <div class="rider-stop">
          <p class="rider-stop-label">Pick up</p>
          <p class="rider-stop-name">${esc(j.vendor_name || "Vendor")}</p>
          <p class="rider-stop-addr">${esc([j.pickup_address, j.pickup_state].filter(Boolean).join(", ") || "Address not set, call the vendor")}</p>
          <div class="rider-stop-actions">
            ${telLink(j.pickup_phone, "Call vendor")}
            ${j.pickup_address ? `<a class="rider-btn small" target="_blank" rel="noopener" href="${mapsLink(j.pickup_address, j.pickup_state)}">Directions</a>` : ""}
          </div>
        </div>`;
    }
    if (!j.dropoff_address) {
      return `
        <div class="rider-stop">
          <p class="rider-stop-label">Drop off</p>
          <p class="rider-stop-addr">${esc(j.dropoff_state || "")} &middot; full address shown once you accept</p>
        </div>`;
    }
    return `
      <div class="rider-stop">
        <p class="rider-stop-label">Drop off</p>
        <p class="rider-stop-name">${esc(j.recipient_name || "Buyer")}</p>
        <p class="rider-stop-addr">${esc([j.dropoff_address, j.dropoff_state].filter(Boolean).join(", "))}</p>
        ${j.delivery_notes ? `<p class="rider-stop-note">“${esc(j.delivery_notes)}”</p>` : ""}
        <div class="rider-stop-actions">
          ${telLink(j.dropoff_phone, "Call buyer")}
          <a class="rider-btn small" target="_blank" rel="noopener" href="${mapsLink(j.dropoff_address, j.dropoff_state)}">Directions</a>
        </div>
      </div>`;
  }

  function failForm() {
    return `
      <form class="rider-inline-form" data-form="fail" hidden>
        <select name="reason" aria-label="What happened">
          <option value="unreachable">Buyer not answering phone</option>
          <option value="not_home">Nobody available to receive</option>
          <option value="wrong_address">Address wrong or not found</option>
          <option value="refused">Buyer refused the package</option>
          <option value="other">Something else</option>
        </select>
        <input name="note" type="text" maxlength="200" placeholder="Short note (optional)" />
        <button class="rider-btn danger" type="submit">Report failed attempt</button>
      </form>`;
  }

  function jobCard(j) {
    const head = `
      <div class="rider-job-head">
        <div>
          <p class="rider-job-ref">${esc(j.ref)} &middot; ${j.item_count} item${Number(j.item_count) === 1 ? "" : "s"}</p>
          <p class="rider-job-status">${esc(RIDER_STATUS_LABEL[j.status] || j.status)}${j.failed_attempts ? ` &middot; attempt ${j.failed_attempts + 1}` : ""}</p>
        </div>
        <span class="rider-job-pay">${formatNaira(j.rider_payout)}</span>
      </div>`;

    let body = "";
    let actions = "";
    switch (j.status) {
      case "assigned":
        body = stopBlock("pickup", j) + stopBlock("dropoff", j);
        actions = `
          <p class="rider-muted">Offer expires in about ${minutesLeft(j.assigned_at)} min.</p>
          <div class="rider-actions">
            <button class="rider-btn primary" data-action="accept">Accept job</button>
            <button class="rider-btn" data-action="decline">Decline</button>
          </div>`;
        break;
      case "accepted":
        body = stopBlock("pickup", j) + stopBlock("dropoff", j);
        actions = `
          <form class="rider-inline-form" data-form="pickup">
            <input name="code" inputmode="numeric" maxlength="4" placeholder="Vendor's 4-digit pickup code" aria-label="Pickup code" required />
            <button class="rider-btn primary" type="submit">Confirm pickup</button>
          </form>
          <div class="rider-actions"><button class="rider-btn" data-action="decline">Can't make it</button></div>`;
        break;
      case "picked_up":
        body = stopBlock("dropoff", j);
        if (j.last_failure_reason) body += `<p class="rider-warning">Last attempt: ${esc(j.last_failure_reason)}</p>`;
        actions = `
          <div class="rider-actions">
            <button class="rider-btn primary" data-action="depart">Start delivery</button>
            <button class="rider-btn" data-action="show-fail">Couldn't deliver</button>
          </div>
          ${failForm()}`;
        break;
      case "out_for_delivery":
        body = stopBlock("dropoff", j);
        actions = `
          <form class="rider-inline-form" data-form="deliver">
            <input name="code" inputmode="numeric" maxlength="6" placeholder="Buyer's 6-digit delivery code" aria-label="Delivery code" required />
            <label class="rider-photo-label">
              <input name="photo" type="file" accept="image/*" capture="environment" />
              <span>Add a photo of the handover (optional)</span>
            </label>
            <button class="rider-btn primary" type="submit">Complete delivery</button>
          </form>
          <p class="rider-muted">Only ask for the code once the buyer has the package in hand.</p>
          <div class="rider-actions"><button class="rider-btn" data-action="show-fail">Couldn't deliver</button></div>
          ${failForm()}`;
        break;
      case "returning":
        body = stopBlock("pickup", j) + `<p class="rider-warning">Return this parcel to the vendor${j.last_failure_reason ? ` (${esc(j.last_failure_reason)})` : ""}. They confirm receipt in their app.</p>`;
        break;
      default:
        body = "";
    }
    return `<article class="rider-card rider-job" data-job-id="${esc(j.id)}">${head}${body}${actions}</article>`;
  }

  function renderJobs() {
    const list = $("tab-jobs");
    const count = $("jobs-count");
    count.hidden = !jobs.length;
    count.textContent = jobs.length;
    if (!jobs.length) {
      list.innerHTML = `<p class="rider-empty">${me && me.rider_on_duty ? "No jobs right now. New offers appear here automatically." : "You're off duty. Switch on duty above to start receiving jobs."}</p>`;
      return;
    }
    // Don't wipe a form the rider is typing into on the next poll.
    if (list.contains(document.activeElement) && document.activeElement.matches("input, select")) return;
    list.innerHTML = jobs.map(jobCard).join("");
  }

  // Paid automatically by Paystack transfer (payout_status), or by hand
  // for jobs from before online payments (rider_paid_at only).
  const PAYOUT_TAG = {
    success: ["Paid", "paid"],
    processing: ["Sending", ""],
    queued: ["Pending", ""],
    awaiting_account: ["Add your bank", "warn"],
    failed: ["Retrying", "warn"],
    reversed: ["Retrying", "warn"],
    cancelled: ["Cancelled", "warn"],
  };
  function payoutTag(j) {
    const [label, cls] = j.rider_paid_at ? PAYOUT_TAG.success : PAYOUT_TAG[j.payout_status] || ["Unpaid", ""];
    return `<span class="rider-paid-tag ${cls}">${label}</span>`;
  }

  async function renderHistory() {
    const list = $("tab-history");
    list.innerHTML = `<p class="rider-empty">Loading…</p>`;
    try {
      const rows = await api("/delivery/rider/history");
      list.innerHTML = rows.length
        ? rows.map((j) => `
            <article class="rider-card rider-history-row">
              <div>
                <p class="rider-job-ref">${esc(j.ref)} &middot; ${esc(j.vendor_name || "")}</p>
                <p class="rider-muted">${j.status === "returned" ? "Returned to vendor" : "Delivered"} ${formatRelativeTimeNG(j.delivered_at || j.returned_at)} &middot; ${esc(j.dropoff_state || "")}</p>
              </div>
              <div class="rider-history-pay">
                <strong>${formatNaira(j.rider_payout)}</strong>
                ${payoutTag(j)}
              </div>
            </article>`).join("")
        : `<p class="rider-empty">Completed deliveries show up here.</p>`;
    } catch (err) {
      list.innerHTML = `<p class="rider-empty">Couldn't load history: ${esc(err.message)}</p>`;
    }
  }

  // ---------- Data ----------

  async function refresh() {
    try {
      const [meRes, jobsRes] = await Promise.all([api("/delivery/rider/me"), api("/delivery/rider/jobs")]);
      me = meRes;
      jobs = jobsRes;
      renderMe();
      renderJobs();
      syncLocationSharing();
    } catch (err) {
      if (err.status === 0) $("tab-jobs").innerHTML = `<p class="rider-empty">${esc(err.message)}</p>`;
    }
  }

  // ---------- Live location ----------

  function needsLocation() {
    return me && me.rider_on_duty && jobs.some((j) => ["accepted", "picked_up", "out_for_delivery", "returning"].includes(j.status));
  }

  function sendPosition(force) {
    if (!lastPosition) return;
    if (!force && Date.now() - lastSentAt < LOCATION_SEND_MS) return;
    lastSentAt = Date.now();
    api("/delivery/rider/location", { method: "POST", body: lastPosition }).catch(() => {});
  }

  function syncLocationSharing() {
    const note = $("rider-location-note");
    if (!("geolocation" in navigator)) return;
    if (needsLocation() && watchId === null) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          lastPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          note.hidden = false;
          note.textContent = "Sharing your location with the buyer while you're on a job.";
          note.classList.remove("warn");
          sendPosition(false);
        },
        () => {
          note.hidden = false;
          note.textContent = "Location is off. Allow location access so buyers can see you're on the way.";
          note.classList.add("warn");
        },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
      );
    } else if (!needsLocation() && watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      note.hidden = true;
    }
  }

  // ---------- Actions ----------

  async function runJobAction(jobId, path, body, successMsg) {
    try {
      await api(`/delivery/rider/jobs/${jobId}/${path}`, { method: "POST", body });
      await refresh();
      if (successMsg) VetraModal.info({ title: "Done", bodyHtml: successMsg });
    } catch (err) {
      VetraModal.info({ title: "Couldn't update job", bodyHtml: esc(err.message) });
      await refresh();
    }
  }

  function wireJobList() {
    const list = $("tab-jobs");

    list.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const card = btn.closest(".rider-job");
      const jobId = card?.dataset.jobId;
      if (!jobId) return;
      const action = btn.dataset.action;

      if (action === "accept") {
        btn.disabled = true;
        runJobAction(jobId, "accept", undefined, "Head to the vendor. Ask them for the 4-digit pickup code when you collect.");
      } else if (action === "decline") {
        VetraModal.confirm({
          title: "Decline this job?",
          bodyHtml: "It goes to another rider. Declining often lowers how many jobs you're offered.",
          confirmLabel: "Decline",
          danger: true,
          showReason: true,
          onConfirm: (reason) => runJobAction(jobId, "decline", { reason }),
        });
      } else if (action === "depart") {
        btn.disabled = true;
        sendPosition(true);
        runJobAction(jobId, "depart");
      } else if (action === "show-fail") {
        const form = card.querySelector('[data-form="fail"]');
        if (form) form.hidden = !form.hidden;
      }
    });

    list.addEventListener("submit", async (e) => {
      const form = e.target.closest("form[data-form]");
      if (!form) return;
      e.preventDefault();
      const jobId = form.closest(".rider-job")?.dataset.jobId;
      const submit = form.querySelector('button[type="submit"]');
      const kind = form.dataset.form;

      if (kind === "pickup") {
        const code = form.code.value.trim();
        if (!/^\d{4}$/.test(code)) return VetraModal.info({ title: "Check the code", bodyHtml: "Pickup codes are 4 digits. The vendor sees it on their Orders page." });
        submit.disabled = true;
        await runJobAction(jobId, "pickup", { pickupCode: code }, "Parcel collected. Tap <strong>Start delivery</strong> when you set off to the buyer.");
      } else if (kind === "deliver") {
        const code = form.code.value.trim();
        if (!/^\d{6}$/.test(code)) return VetraModal.info({ title: "Check the code", bodyHtml: "Delivery codes are 6 digits. The buyer sees it on their Orders page and in their email." });
        submit.disabled = true;
        submit.textContent = "Completing…";
        let photoUrl = null;
        const file = form.photo.files[0];
        if (file) {
          try {
            photoUrl = await VetraAPI.uploadFile(file, { role: "rider", folder: "delivery-proof" });
          } catch (err) {
            // A failed photo shouldn't block the handover itself.
            photoUrl = null;
          }
        }
        await runJobAction(jobId, "deliver", { code, photoUrl }, "Delivered. Nice work, the payout is added to your earnings.");
      } else if (kind === "fail") {
        const reason = form.reason.value;
        const note = form.note.value.trim();
        submit.disabled = true;
        try {
          const result = await api(`/delivery/rider/jobs/${jobId}/fail`, { method: "POST", body: { reason, note } });
          await refresh();
          VetraModal.info({
            title: result.returning ? "Return to vendor" : "Attempt logged",
            bodyHtml: result.returning
              ? "This parcel now goes back to the vendor. Drop it at their store, they'll confirm receipt."
              : "The buyer has been notified. Try again when you can reach them.",
          });
        } catch (err) {
          VetraModal.info({ title: "Couldn't log attempt", bodyHtml: esc(err.message) });
          submit.disabled = false;
        }
      }
    });
  }

  function wireDutySwitch() {
    $("rider-duty-switch").addEventListener("click", async () => {
      const next = !me.rider_on_duty;
      if (!next && jobs.some((j) => j.status !== "assigned")) {
        VetraModal.info({ title: "Finish your jobs first", bodyHtml: "You can go off duty once your active deliveries are done or returned." });
        return;
      }
      try {
        await api("/delivery/rider/duty", { method: "PATCH", body: { onDuty: next } });
        await refresh();
      } catch (err) {
        VetraModal.info({ title: "Couldn't change duty status", bodyHtml: esc(err.message) });
      }
    });
  }

  function wireZonePicker() {
    const zone = $("rider-zone");
    zone.addEventListener("change", async () => {
      const previous = me.state;
      try {
        await api("/delivery/rider/zone", { method: "PATCH", body: { state: zone.value } });
        await refresh();
      } catch (err) {
        zone.value = previous || "";
        VetraModal.info({ title: "Couldn't change your area", bodyHtml: esc(err.message) });
      }
    });
  }

  // ---------- Payout bank account ----------

  let banksLoaded = false;
  let resolvedName = null;
  let resolveSeq = 0;

  async function renderBank() {
    try {
      const account = await api("/delivery/rider/payout-account");
      $("bank-current").textContent = account.isSet
        ? `${account.accountName}, ${account.bankName} ${account.maskedAccountNumber}. Payouts go here.`
        : "No account yet. Add one so your delivery earnings can be paid automatically.";
      $("bank-missing-dot").hidden = account.isSet;
    } catch (err) {
      $("bank-current").textContent = `Couldn't load your account: ${err.message}`;
    }
    if (!banksLoaded) {
      try {
        const banks = await api("/delivery/rider/payout-account/banks");
        $("bank-code").innerHTML = `<option value="">Choose your bank</option>${banks
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((b) => `<option value="${esc(b.code)}">${esc(b.name)}</option>`)
          .join("")}`;
        banksLoaded = true;
      } catch (err) {
        $("bank-code").innerHTML = `<option value="">Couldn't load banks</option>`;
      }
    }
  }

  // Looks the account name up as soon as there's a bank and 10 digits,
  // so the rider confirms it's theirs before saving.
  async function resolveBankName() {
    const bankCode = $("bank-code").value;
    const accountNumber = $("bank-account-number").value.trim();
    resolvedName = null;
    $("bank-save").disabled = true;
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) {
      $("bank-resolved").textContent = "Choose your bank and enter your account number.";
      return;
    }
    const seq = ++resolveSeq;
    $("bank-resolved").textContent = "Checking with your bank…";
    try {
      const result = await api(`/delivery/rider/payout-account/resolve?bankCode=${encodeURIComponent(bankCode)}&accountNumber=${accountNumber}`);
      if (seq !== resolveSeq) return;
      resolvedName = result.accountName;
      $("bank-resolved").innerHTML = `Account name: <strong>${esc(result.accountName)}</strong>`;
      $("bank-save").disabled = false;
    } catch (err) {
      if (seq !== resolveSeq) return;
      $("bank-resolved").textContent = err.message;
    }
  }

  function wireBankForm() {
    $("bank-code").addEventListener("change", resolveBankName);
    $("bank-account-number").addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
      resolveBankName();
    });
    $("bank-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!resolvedName) return;
      const select = $("bank-code");
      $("bank-save").disabled = true;
      try {
        await api("/delivery/rider/payout-account", {
          method: "PUT",
          body: {
            bankCode: select.value,
            bankName: select.options[select.selectedIndex].text,
            accountNumber: $("bank-account-number").value.trim(),
          },
        });
        $("bank-account-number").value = "";
        $("bank-resolved").textContent = "Saved. Any payouts waiting for an account are on their way.";
        resolvedName = null;
        await renderBank();
      } catch (err) {
        $("bank-resolved").textContent = err.message;
        $("bank-save").disabled = false;
      }
    });
  }

  function wireTabs() {
    document.querySelectorAll(".rider-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".rider-tab").forEach((t) => {
          t.classList.toggle("active", t === tab);
          t.setAttribute("aria-selected", String(t === tab));
        });
        const which = tab.dataset.tab;
        $("tab-jobs").hidden = which !== "jobs";
        $("tab-history").hidden = which !== "history";
        $("tab-bank").hidden = which !== "bank";
        if (which === "history") renderHistory();
        if (which === "bank") renderBank();
      });
    });
  }

  async function init() {
    if (!VetraAPI.getToken("rider")) {
      window.location.replace("login.html");
      return;
    }
    $("rider-signout").addEventListener("click", () => {
      VetraAPI.clearSession("rider");
      window.location.replace("login.html");
    });
    wireTabs();
    wireDutySwitch();
    wireZonePicker();
    wireBankForm();
    renderBank();
    wireJobList();
    await refresh();
    setInterval(() => {
      if (!document.hidden) refresh();
    }, RIDER_POLL_MS);
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", RiderApp.init);
