/* =========================================================
   VETRA: Public order tracking (track.html).
   Looks up a tracking ID (orders.tracking_code, "VTA-XXXXXXXX")
   against GET /api/delivery/track/:code, which returns status and
   timeline only, nothing personal (backend/src/routes/
   delivery.routes.js). Works for guests and for anyone a buyer shares
   the ID with; order emails link here with ?code= filled in. While a
   parcel is out for delivery, the rider's live position is shown and
   refreshed every 30 seconds.
   ========================================================= */

(function () {
  const form = document.getElementById("track-form");
  const input = document.getElementById("track-code");
  const errorEl = document.getElementById("track-error");
  const result = document.getElementById("track-result");
  const esc = (v) => VetraAPI.escapeHtml(v ?? "");
  let refreshTimer = null;

  const STEPS = [
    { key: "placed", label: "Order placed" },
    { key: "packed", label: "Packed by vendor" },
    { key: "picked", label: "Picked up" },
    { key: "out", label: "Out for delivery" },
    { key: "delivered", label: "Delivered" },
  ];
  const STEP_INDEX = {
    awaiting_vendor: 0, ready: 1, assigned: 1, accepted: 1,
    picked_up: 2, out_for_delivery: 3, delivered: 4,
  };

  function normalise(code) {
    const raw = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!raw) return "";
    const body = raw.startsWith("VTA") ? raw.slice(3) : raw;
    return `VTA-${body}`;
  }

  function render(t) {
    const d = t.delivery;
    const pickup = t.deliveryMethod === "pickup";
    let headline;
    let stepsHtml = "";

    if (pickup) {
      headline = t.orderStatus === "completed" ? "Collected from the store" : t.orderStatus === "cancelled" ? "Cancelled" : "Waiting for you to collect from the store";
    } else if (!d) {
      headline = ORDER_STATUS_LABEL[t.orderStatus] || t.orderStatus;
    } else {
      headline = d.mode === "self" && !["delivered", "cancelled"].includes(d.status)
        ? "The vendor is shipping this with their own courier"
        : DELIVERY_STATUS_LABEL[d.status] || d.status;
      if (d.status in STEP_INDEX) {
        const current = STEP_INDEX[d.status];
        stepsHtml = `<ol class="track-steps">${STEPS.map((s, i) => `<li class="${i < current ? "done" : i === current ? "current" : ""}">${s.label}</li>`).join("")}</ol>`;
      }
    }

    const facts = [
      `<div><span>Tracking ID</span><strong>${esc(t.trackingCode)}</strong></div>`,
      `<div><span>Sold by</span><strong>${esc(t.vendorName || "—")}</strong></div>`,
      `<div><span>Placed</span><strong>${formatDateNG(t.placedAt, { day: "numeric", month: "short", year: "numeric" })}</strong></div>`,
      !pickup && t.destinationState ? `<div><span>Delivering to</span><strong>${esc(t.destinationState)}</strong></div>` : "",
    ].join("");

    const rider = d && d.rider
      ? `<p class="track-rider">Your rider is <strong>${esc(d.rider.firstName)}</strong>${d.rider.vehicle ? ` on a ${esc((RIDER_VEHICLE_LABEL[d.rider.vehicle] || "").toLowerCase())}` : ""}.</p>`
      : "";
    const map = d && d.location
      ? `<div class="track-map">${riderMapEmbedMarkup(d.location)}<p>Rider's position, updated ${formatRelativeTimeNG(d.location.at)}</p></div>`
      : "";
    const attempts = d && d.failedAttempts && !["delivered", "returned", "cancelled"].includes(d.status)
      ? `<p class="track-note">${d.failedAttempts} delivery attempt${d.failedAttempts === 1 ? " was" : "s were"} missed. Keep your phone on so the rider can reach you.</p>`
      : "";
    const events = d && d.events && d.events.length
      ? `<ul class="track-events">${d.events.slice().reverse().map((e) => `<li><strong>${esc(e.note)}</strong><time>${formatDateTimeNG(e.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time></li>`).join("")}</ul>`
      : "";

    result.innerHTML = `
      <div class="track-card">
        <p class="eyebrow">Current status</p>
        <h2>${esc(headline)}</h2>
        ${stepsHtml}
        ${rider}
        ${attempts}
        ${map}
        <div class="track-facts">${facts}</div>
        ${events}
        <p class="track-foot">Signed in? Your Orders page shows your delivery code and the rider's phone number.</p>
      </div>`;
    result.hidden = false;
  }

  async function lookup(code, { quiet } = {}) {
    if (!quiet) {
      errorEl.hidden = true;
      result.hidden = true;
    }
    try {
      const t = await VetraAPI.request(`/delivery/track/${encodeURIComponent(code)}`);
      render(t);
      clearInterval(refreshTimer);
      if (t.delivery && ["accepted", "picked_up", "out_for_delivery"].includes(t.delivery.status)) {
        refreshTimer = setInterval(() => {
          if (!document.hidden) lookup(code, { quiet: true });
        }, 30000);
      }
    } catch (err) {
      if (quiet) return;
      errorEl.textContent = err.status === 404 ? "We couldn't find an order with that tracking ID. Check it against your order email." : err.message;
      errorEl.hidden = false;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = normalise(input.value);
    if (code.length < 12) {
      errorEl.textContent = "Tracking IDs look like VTA-XXXXXXXX.";
      errorEl.hidden = false;
      return;
    }
    input.value = code;
    history.replaceState(null, "", `?code=${encodeURIComponent(code)}`);
    lookup(code);
  });

  const fromUrl = new URLSearchParams(window.location.search).get("code");
  if (fromUrl) {
    input.value = normalise(fromUrl);
    lookup(input.value);
  }
})();
