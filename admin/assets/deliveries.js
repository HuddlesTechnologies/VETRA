/* =========================================================
   VETRA: Admin deliveries console (admin/deliveries.html).
   Three sections over /api/delivery/admin (backend/src/routes/
   delivery.routes.js):

   - Dispatch: every delivery grouped by what needs doing next
     ("Needs rider" first). Assign or reassign a rider, take a job
     back, cancel before pickup, send an in-flight parcel back to the
     vendor, unlock an order whose delivery code was guessed wrong too
     many times, and expand any row for its full event timeline.
   - Riders: add riders (they get a set-password email), edit zone
     and vehicle, suspend/reactivate, resend the invite, and record a
     payout of everything a rider has earned so far.
   - Rates & settings: per-state fees and the delivery switches.

   Server-side role checks are the real boundary (Support can view,
   Moderator and Super Admin dispatch, only Super Admin touches money
   and rates); the UI just doesn't offer what a role can't do.
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;

  const esc = (v) => VetraAPI.escapeHtml(v ?? "");
  const api = (path, opts = {}) => VetraAPI.request(`/delivery/admin${path}`, { role: "admin", ...opts });
  const canDispatch = canModerate();
  const superAdmin = isSuperAdmin();

  let group = "queue";
  let riders = [];
  let deliveries = [];
  const openTimelines = new Set();

  // ---------- Small form modal (assign rider, add/edit rider) ----------
  // VetraModal only does confirm/info with an optional reason box; these
  // need real fields, so this page mounts one extra modal of its own,
  // reusing the same .modal-overlay styles.
  const formModal = (() => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="modal-overlay" id="delivery-form-modal" hidden>
        <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delivery-form-title">
          <div class="modal-header">
            <h2 id="delivery-form-title"></h2>
            <button type="button" class="modal-close-btn" data-close aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <form id="delivery-form-body"></form>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
    const overlay = document.getElementById("delivery-form-modal");
    const form = document.getElementById("delivery-form-body");
    let onSubmit = null;

    function close() {
      overlay.hidden = true;
      onSubmit = null;
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-close]")) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) close();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!onSubmit) return;
      const btn = form.querySelector('button[type="submit"]');
      const errorEl = form.querySelector(".delivery-form-error");
      btn.disabled = true;
      errorEl.hidden = true;
      try {
        await onSubmit(new FormData(form));
        close();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        btn.disabled = false;
      }
    });

    return {
      open({ title, fieldsHtml, submitLabel, handler }) {
        document.getElementById("delivery-form-title").textContent = title;
        form.innerHTML = `${fieldsHtml}
          <p class="delivery-form-error" hidden></p>
          <div class="form-actions">
            <button type="button" class="btn btn-cancel" data-close>Cancel</button>
            <button type="submit" class="btn btn-save">${submitLabel}</button>
          </div>`;
        onSubmit = handler;
        overlay.hidden = false;
        form.querySelector("input, select")?.focus();
      },
    };
  })();

  // ---------- Overview ----------

  async function loadOverview() {
    const grid = document.getElementById("delivery-stats");
    try {
      const o = await api("/overview");
      const s = o.byStatus;
      const sum = (...keys) => keys.reduce((n, k) => n + (s[k] || 0), 0);
      const cards = [
        { label: "Needs a rider", value: sum("ready"), tint: "amber", sub: `${sum("assigned")} offered, awaiting accept` },
        { label: "In progress", value: sum("accepted", "picked_up", "out_for_delivery"), tint: "blue", sub: `${sum("out_for_delivery")} out for delivery now` },
        { label: "Returning", value: sum("returning"), tint: "red", sub: o.lockedCodes ? `${o.lockedCodes} locked delivery code${o.lockedCodes === 1 ? "" : "s"}` : "No locked codes" },
        { label: "Riders on duty", value: o.riders.onDuty, tint: "green", sub: `${o.riders.total} rider${o.riders.total === 1 ? "" : "s"} total · auto-assign ${o.settings.autoAssignRiders ? "on" : "off"}` },
      ];
      grid.innerHTML = cards
        .map((c) => `
          <div class="stat-card">
            <div class="stat-card-head"><p class="stat-label">${c.label}</p></div>
            <p class="stat-value">${c.value.toLocaleString()}</p>
            <span class="stat-trend" style="color: var(--muted)">${c.sub}</span>
          </div>`)
        .join("");
    } catch (err) {
      grid.innerHTML = `<p class="table-empty">Couldn't load delivery stats: ${esc(err.message)}</p>`;
    }
  }

  // ---------- Dispatch ----------

  function statusBadgeClass(status) {
    if (["ready", "assigned"].includes(status)) return "pending";
    if (["returning", "cancelled"].includes(status)) return "suspended";
    if (["delivered"].includes(status)) return "active";
    if (["returned"].includes(status)) return "dismissed";
    return "resolved";
  }

  function deliveryActions(d) {
    if (!canDispatch || d.mode === "self") return d.mode === "self" ? `<span class="cell-muted">Vendor self-ships</span>` : "";
    const b = (action, label, cls = "btn-view") => `<button class="${cls}" data-action="${action}" data-id="${d.id}">${label}</button>`;
    const out = [];
    if (["ready", "assigned", "accepted"].includes(d.status)) out.push(b("assign", d.rider_id ? "Reassign" : "Assign rider", "btn-approve"));
    if (["assigned", "accepted"].includes(d.status)) out.push(b("unassign", "Take back"));
    if (["awaiting_vendor", "ready", "assigned", "accepted"].includes(d.status)) out.push(b("cancel", "Cancel", "btn-suspend"));
    if (["picked_up", "out_for_delivery"].includes(d.status)) out.push(b("return", "Send back", "btn-suspend"));
    if (d.code_locked && !["delivered", "returned", "cancelled"].includes(d.status)) out.push(b("unlock", "Unlock code", "btn-activate"));
    return out.join("");
  }

  function deliveryRow(d) {
    const age = formatRelativeTimeNG(d.updated_at);
    return `
      <tr data-id="${d.id}" class="delivery-row">
        <td>
          <div class="cell-title">${esc(d.ref)}</div>
          <div class="cell-sub">${esc(d.vendor_name || "")} → ${esc(d.buyer_name || "Guest")}</div>
        </td>
        <td>
          <div class="cell-title">${esc(d.pickup_state || "?")} → ${esc(d.dropoff_state || "?")}</div>
          <div class="cell-sub">${d.failed_attempts ? `${d.failed_attempts} failed attempt${d.failed_attempts === 1 ? "" : "s"}` : `updated ${age}`}</div>
        </td>
        <td>
          <span class="badge ${statusBadgeClass(d.status)}">${esc(DELIVERY_STATUS_LABEL[d.status] || d.status)}</span>
          ${d.code_locked ? `<div class="cell-sub" style="color:#b91c1c;">Code locked</div>` : ""}
        </td>
        <td>${d.rider_name ? esc(d.rider_name) : `<span class="cell-muted">—</span>`}</td>
        <td>
          <div class="cell-title">${formatNaira(d.fee_charged)}</div>
          <div class="cell-sub">rider ${formatNaira(d.rider_payout)}</div>
        </td>
        <td>
          <div class="table-actions">
            ${deliveryActions(d)}
            <button class="btn-view" data-action="timeline" data-id="${d.id}" data-order-id="${d.order_id}">${openTimelines.has(d.id) ? "Hide" : "Timeline"}</button>
          </div>
        </td>
      </tr>
      ${openTimelines.has(d.id) ? `<tr class="delivery-timeline-row" data-timeline-for="${d.id}"><td colspan="6"><p class="cell-muted">Loading timeline…</p></td></tr>` : ""}`;
  }

  async function loadDeliveries() {
    const tbody = document.querySelector("#deliveries-table tbody");
    tbody.innerHTML = `<tr><td colspan="6"><p class="table-empty">Loading…</p></td></tr>`;
    const params = new URLSearchParams();
    if (group) params.set("group", group);
    const state = document.getElementById("delivery-state-filter").value;
    if (state) params.set("state", state);
    const q = document.getElementById("delivery-search").value.trim();
    if (q) {
      params.set("q", q);
      params.delete("group");
    }
    try {
      deliveries = await api(`/deliveries?${params}`);
      renderDeliveries();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6"><p class="table-empty">Couldn't load deliveries: ${esc(err.message)}</p></td></tr>`;
    }
  }

  function renderDeliveries() {
    const tbody = document.querySelector("#deliveries-table tbody");
    if (!deliveries.length) {
      tbody.innerHTML = `<tr><td colspan="6"><p class="table-empty">Nothing here right now.</p></td></tr>`;
      return;
    }
    tbody.innerHTML = deliveries.map(deliveryRow).join("");
    openTimelines.forEach((id) => {
      const d = deliveries.find((x) => x.id === id);
      if (d) loadTimeline(d);
    });
  }

  async function loadTimeline(d) {
    const cell = document.querySelector(`[data-timeline-for="${d.id}"] td`);
    if (!cell) return;
    try {
      const info = await VetraAPI.request(`/delivery/orders/${d.order_id}`, { role: "admin" });
      const del = info.delivery;
      const facts = [
        `<span>Pickup code <strong>${esc(del.pickupCode)}</strong></span>`,
        del.rider ? `<span>Rider ${esc(del.rider.name)}${del.rider.phone ? ` · <a href="tel:${encodeURIComponent(del.rider.phone)}">${esc(del.rider.phone)}</a>` : ""}</span>` : "",
        del.location ? `<span>Last seen ${formatRelativeTimeNG(del.location.at)} · <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${del.location.lat}&mlon=${del.location.lng}#map=16/${del.location.lat}/${del.location.lng}">map</a></span>` : "",
        del.proofPhotoUrl ? `<span><a target="_blank" rel="noopener" href="${esc(del.proofPhotoUrl)}">Proof of delivery photo</a></span>` : "",
        info.confirmDeadline ? `<span>Escrow auto-releases ${formatDateTimeNG(info.confirmDeadline)}</span>` : "",
      ].filter(Boolean);
      cell.innerHTML = `
        <div class="delivery-timeline">
          <div class="delivery-timeline-facts">${facts.join("")}</div>
          <ol>${del.events
            .map((e) => `<li><time>${formatDateTimeNG(e.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time><span>${esc(e.note || e.event)}${e.actor_name ? ` <em>· ${esc(e.actor_name)}</em>` : ""}</span></li>`)
            .join("")}</ol>
        </div>`;
    } catch (err) {
      cell.innerHTML = `<p class="cell-muted">Couldn't load timeline: ${esc(err.message)}</p>`;
    }
  }

  async function refreshDispatch() {
    await Promise.all([loadDeliveries(), loadOverview()]);
  }

  function openAssign(d) {
    // Riders working the vendor's state first, on-duty first within that,
    // fewest live jobs first: the same order auto-assign would pick in.
    const candidates = riders
      .filter((r) => r.status === "active")
      .sort((a, b) =>
        (b.state === d.pickup_state) - (a.state === d.pickup_state)
        || b.rider_on_duty - a.rider_on_duty
        || a.active_jobs - b.active_jobs);
    if (!candidates.length) {
      AdminUI.info({ title: "No riders yet", bodyHtml: "Add a rider from the Riders tab first." });
      return;
    }
    formModal.open({
      title: `Assign ${d.ref}`,
      submitLabel: "Offer job",
      fieldsHtml: `
        <p class="confirm-modal-body">Pickup in <strong>${esc(d.pickup_state || "unknown state")}</strong>. The rider has 20 minutes to accept before it returns to the queue.</p>
        <div class="form-group full">
          <label class="form-label" for="assign-rider">Rider</label>
          <select class="form-input" id="assign-rider" name="riderId">
            ${candidates
              .map((r) => `<option value="${r.id}"${r.id === d.rider_id ? " selected" : ""}>${esc(r.name)} — ${esc(r.state || "?")}, ${r.rider_on_duty ? "on duty" : "off duty"}, ${r.active_jobs} live job${r.active_jobs === 1 ? "" : "s"}</option>`)
              .join("")}
          </select>
        </div>`,
      handler: async (fd) => {
        await api(`/deliveries/${d.id}/assign`, { method: "POST", body: { riderId: fd.get("riderId") } });
        await refreshDispatch();
      },
    });
  }

  function wireDispatch() {
    const stateFilter = document.getElementById("delivery-state-filter");
    stateFilter.insertAdjacentHTML("beforeend", stateOptionsMarkup());
    stateFilter.addEventListener("change", loadDeliveries);

    let searchTimer = null;
    document.getElementById("delivery-search").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadDeliveries, 350);
    });

    document.getElementById("delivery-group-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest(".filter-tab");
      if (!tab) return;
      document.querySelectorAll("#delivery-group-tabs .filter-tab").forEach((t) => t.classList.toggle("active", t === tab));
      group = tab.dataset.group;
      loadDeliveries();
    });

    document.querySelector("#deliveries-table tbody").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const d = deliveries.find((x) => x.id === btn.dataset.id);
      if (!d) return;
      const run = async (path, body) => {
        try {
          await api(`/deliveries/${d.id}/${path}`, { method: "POST", body });
          await refreshDispatch();
        } catch (err) {
          AdminUI.info({ title: "Couldn't update delivery", bodyHtml: esc(err.message) });
        }
      };

      switch (btn.dataset.action) {
        case "timeline":
          if (openTimelines.has(d.id)) openTimelines.delete(d.id);
          else openTimelines.add(d.id);
          renderDeliveries();
          break;
        case "assign":
          openAssign(d);
          break;
        case "unassign":
          AdminUI.confirm({
            title: "Take this job back?",
            bodyHtml: `<span class="confirm-modal-target">${esc(d.rider_name)}</span> is told it's been reassigned, and the parcel returns to the queue.`,
            confirmLabel: "Take back",
            onConfirm: () => run("unassign"),
          });
          break;
        case "cancel":
          AdminUI.confirm({
            title: `Cancel ${d.ref}?`,
            bodyHtml: "The order is cancelled and refunded, and the buyer, vendor and any rider are told. Only possible before pickup.",
            confirmLabel: "Cancel order",
            danger: true,
            requireReason: true,
            onConfirm: (reason) => run("cancel", { reason }),
          });
          break;
        case "return":
          AdminUI.confirm({
            title: "Send back to vendor?",
            bodyHtml: "The rider is told to return the parcel. The order cancels once the vendor confirms they have it.",
            confirmLabel: "Send back",
            danger: true,
            requireReason: true,
            onConfirm: (reason) => run("return", { reason }),
          });
          break;
        case "unlock":
          AdminUI.confirm({
            title: "Unlock delivery code?",
            bodyHtml: "Only do this after confirming with the buyer by phone that the rider is genuinely with them. It resets the wrong-code counter.",
            confirmLabel: "Unlock",
            onConfirm: () => run("unlock-code"),
          });
          break;
        default:
          break;
      }
    });
  }

  // ---------- Riders ----------

  function riderFields(r = {}) {
    const vehicle = r.rider_vehicle || "motorbike";
    return `
      <div class="form-grid">
        <div class="form-group full">
          <label class="form-label" for="rider-name-input">Full name</label>
          <input class="form-input" id="rider-name-input" name="name" value="${esc(r.name || "")}" required />
        </div>
        ${r.id ? "" : `
        <div class="form-group full">
          <label class="form-label" for="rider-email-input">Email <span class="form-hint">(the set-password link goes here)</span></label>
          <input class="form-input" id="rider-email-input" name="email" type="email" required />
        </div>`}
        <div class="form-group">
          <label class="form-label" for="rider-phone-input">Phone</label>
          <input class="form-input" id="rider-phone-input" name="phone" type="tel" value="${esc(r.phone || "")}" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="rider-state-input">Operating state</label>
          <select class="form-input" id="rider-state-input" name="state">${stateOptionsMarkup(r.state || "Lagos")}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="rider-vehicle-input">Vehicle</label>
          <select class="form-input" id="rider-vehicle-input" name="vehicle">
            ${Object.entries(RIDER_VEHICLE_LABEL).map(([v, l]) => `<option value="${v}"${v === vehicle ? " selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="rider-plate-input">Plate number <span class="form-hint">(optional)</span></label>
          <input class="form-input" id="rider-plate-input" name="plate" value="${esc(r.rider_plate || "")}" />
        </div>
      </div>`;
  }

  async function loadRiders() {
    const tbody = document.querySelector("#riders-table tbody");
    try {
      riders = await api("/riders");
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6"><p class="table-empty">Couldn't load riders: ${esc(err.message)}</p></td></tr>`;
      return;
    }
    if (!riders.length) {
      tbody.innerHTML = `<tr><td colspan="6"><p class="table-empty">No riders yet. Add your first one to start dispatching.</p></td></tr>`;
      return;
    }
    tbody.innerHTML = riders
      .map((r) => {
        const b = (action, label, cls = "btn-view") => `<button class="${cls}" data-action="${action}" data-id="${r.id}">${label}</button>`;
        const actions = [];
        if (canDispatch) {
          actions.push(b("edit", "Edit"));
          actions.push(r.status === "active" ? b("suspend", "Suspend", "btn-suspend") : b("activate", "Reactivate", "btn-activate"));
          if (r.status === "active") actions.push(b("invite", "Resend invite"));
        }
        if (superAdmin && r.unpaid > 0) actions.push(b("pay", "Mark paid", "btn-approve"));
        return `
          <tr>
            <td>
              <div class="cell-title">${esc(r.name)}</div>
              <div class="cell-sub">${esc(r.email)} · ${esc(r.phone || "")}</div>
            </td>
            <td>
              <div class="cell-title">${esc(r.state || "—")}</div>
              <div class="cell-sub">${esc(RIDER_VEHICLE_LABEL[r.rider_vehicle] || "")}${r.rider_plate ? ` · ${esc(r.rider_plate)}` : ""}</div>
            </td>
            <td>
              <div class="cell-title">${r.delivered} delivered</div>
              <div class="cell-sub">${r.active_jobs} live · ${r.returned} returned</div>
            </td>
            <td>${formatNaira(r.unpaid)}</td>
            <td>
              <span class="badge ${r.status}">${esc(r.status)}</span>
              <div class="cell-sub">${r.status === "active" ? (r.rider_on_duty ? "On duty" : "Off duty") : ""}</div>
            </td>
            <td><div class="table-actions">${actions.join("") || `<span class="cell-muted">View only</span>`}</div></td>
          </tr>`;
      })
      .join("");
  }

  function wireRiders() {
    const addBtn = document.getElementById("add-rider-btn");
    if (!canDispatch) addBtn.hidden = true;
    addBtn.addEventListener("click", () => {
      formModal.open({
        title: "Add a rider",
        submitLabel: "Add rider",
        fieldsHtml: riderFields(),
        handler: async (fd) => {
          await api("/riders", { method: "POST", body: Object.fromEntries(fd) });
          await loadRiders();
          AdminUI.info({ title: "Rider added", bodyHtml: "They've been emailed a link to set their password (valid 72 hours), then they sign in at <strong>/rider/login.html</strong>." });
        },
      });
    });

    document.querySelector("#riders-table tbody").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const r = riders.find((x) => x.id === btn.dataset.id);
      if (!r) return;
      const patch = async (body) => {
        try {
          await api(`/riders/${r.id}`, { method: "PATCH", body });
          await Promise.all([loadRiders(), loadOverview()]);
        } catch (err) {
          AdminUI.info({ title: "Couldn't update rider", bodyHtml: esc(err.message) });
        }
      };
      switch (btn.dataset.action) {
        case "edit":
          formModal.open({
            title: `Edit ${r.name}`,
            submitLabel: "Save",
            fieldsHtml: riderFields(r),
            handler: async (fd) => {
              await api(`/riders/${r.id}`, { method: "PATCH", body: Object.fromEntries(fd) });
              await loadRiders();
            },
          });
          break;
        case "suspend":
          AdminUI.confirm({
            title: "Suspend rider?",
            bodyHtml: `<span class="confirm-modal-target">${esc(r.name)}</span> is signed out and taken off duty. Jobs they haven't collected yet go back to the queue.`,
            confirmLabel: "Suspend",
            danger: true,
            onConfirm: () => patch({ status: "suspended" }),
          });
          break;
        case "activate":
          patch({ status: "active" });
          break;
        case "invite":
          api(`/riders/${r.id}/resend-invite`, { method: "POST" })
            .then(() => AdminUI.info({ title: "Invite sent", bodyHtml: `A fresh set-password link was emailed to ${esc(r.email)}.` }))
            .catch((err) => AdminUI.info({ title: "Couldn't send invite", bodyHtml: esc(err.message) }));
          break;
        case "pay":
          AdminUI.confirm({
            title: `Record payout to ${r.name}?`,
            bodyHtml: `Marks <strong>${formatNaira(r.unpaid)}</strong> as paid. Send the bank transfer first, this only records it.`,
            confirmLabel: "Mark paid",
            onConfirm: async () => {
              try {
                const res = await api(`/riders/${r.id}/payouts`, { method: "POST" });
                await loadRiders();
                AdminUI.info({ title: "Payout recorded", bodyHtml: `${formatNaira(res.amount)} for ${res.jobs} job${res.jobs === 1 ? "" : "s"}.` });
              } catch (err) {
                AdminUI.info({ title: "Couldn't record payout", bodyHtml: esc(err.message) });
              }
            },
          });
          break;
        default:
          break;
      }
    });
  }

  // ---------- Rates & settings ----------

  const toNaira = (kobo) => Math.round(Number(kobo) / 100);

  async function loadRates() {
    const tbody = document.querySelector("#rates-table tbody");
    try {
      const [rates, overview] = await Promise.all([api("/rates"), api("/overview")]);
      const s = overview.settings;
      document.getElementById("set-free-threshold").value = toNaira(s.freeDeliveryThreshold);
      document.getElementById("set-payout-percent").value = s.riderPayoutPercent;
      document.getElementById("set-confirm-hours").value = s.autoConfirmHours;
      document.getElementById("set-max-attempts").value = s.maxDeliveryAttempts;
      document.getElementById("set-auto-assign").checked = s.autoAssignRiders;

      const ro = superAdmin ? "" : " disabled";
      tbody.innerHTML = rates
        .map((r) => `
          <tr data-state="${esc(r.state)}">
            <td><div class="cell-title">${esc(r.state)}</div></td>
            <td><input class="form-input rate-input" type="number" min="0" step="50" name="intra" value="${toNaira(r.intra_state_fee)}"${ro} /></td>
            <td><input class="form-input rate-input" type="number" min="0" step="50" name="inter" value="${toNaira(r.inter_state_fee)}"${ro} /></td>
            <td class="rate-days">
              <input class="form-input rate-input small" type="number" min="0" max="30" name="min" value="${r.eta_days_min}"${ro} />
              <span>–</span>
              <input class="form-input rate-input small" type="number" min="0" max="30" name="max" value="${r.eta_days_max}"${ro} />
            </td>
            <td><label class="switch"><input type="checkbox" name="active"${r.active ? " checked" : ""}${ro} /><span class="slider"></span></label></td>
            <td>${superAdmin ? `<button class="btn-view" data-action="save-rate" hidden>Save</button>` : ""}</td>
          </tr>`)
        .join("");
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6"><p class="table-empty">Couldn't load rates: ${esc(err.message)}</p></td></tr>`;
    }
  }

  function wireRates() {
    const form = document.getElementById("delivery-settings-form");
    if (!superAdmin) {
      form.querySelectorAll("input").forEach((i) => (i.disabled = true));
      document.getElementById("delivery-settings-actions").hidden = true;
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/settings", {
          method: "PATCH",
          body: {
            freeDeliveryThreshold: Math.round(Number(document.getElementById("set-free-threshold").value || 0)) * 100,
            riderPayoutPercent: Number(document.getElementById("set-payout-percent").value),
            autoConfirmHours: Number(document.getElementById("set-confirm-hours").value),
            maxDeliveryAttempts: Number(document.getElementById("set-max-attempts").value),
            autoAssignRiders: document.getElementById("set-auto-assign").checked,
          },
        });
        await loadOverview();
        AdminUI.info({ title: "Settings saved", bodyHtml: "New delivery settings apply to orders from now on." });
      } catch (err) {
        AdminUI.info({ title: "Couldn't save settings", bodyHtml: esc(err.message) });
      }
    });

    const tbody = document.querySelector("#rates-table tbody");
    // A row's Save button only appears once something in it changed.
    tbody.addEventListener("input", (e) => {
      const row = e.target.closest("tr");
      const save = row?.querySelector('[data-action="save-rate"]');
      if (save) save.hidden = false;
    });
    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest('[data-action="save-rate"]');
      if (!btn) return;
      const row = btn.closest("tr");
      const val = (n) => row.querySelector(`[name="${n}"]`);
      btn.disabled = true;
      try {
        await api(`/rates/${encodeURIComponent(row.dataset.state)}`, {
          method: "PUT",
          body: {
            intraStateFee: Math.round(Number(val("intra").value || 0)) * 100,
            interStateFee: Math.round(Number(val("inter").value || 0)) * 100,
            etaDaysMin: Number(val("min").value),
            etaDaysMax: Number(val("max").value),
            active: val("active").checked,
          },
        });
        btn.hidden = true;
      } catch (err) {
        AdminUI.info({ title: "Couldn't save rate", bodyHtml: esc(err.message) });
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---------- Section tabs ----------

  function wireSections() {
    const tabs = document.querySelectorAll("#delivery-section-tabs .filter-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.toggle("active", t === tab));
        ["dispatch", "riders", "rates"].forEach((s) => {
          document.getElementById(`section-${s}`).hidden = s !== tab.dataset.section;
        });
        if (tab.dataset.section === "rates") loadRates();
        if (tab.dataset.section === "riders") loadRiders();
      });
    });
  }

  wireSections();
  wireDispatch();
  wireRiders();
  wireRates();
  await Promise.all([loadRiders(), refreshDispatch()]);

  // Dispatch is the one admin view where things change on their own
  // (riders accepting, parcels moving), so it refreshes itself.
  setInterval(() => {
    if (!document.hidden && !document.getElementById("section-dispatch").hidden) refreshDispatch();
  }, 30000);
});
