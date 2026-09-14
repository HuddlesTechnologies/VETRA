/* =========================================================
   VETRA — VENDOR ORDER TRACKING & SHIPMENT UPDATES
   Page-specific script for vendor/orders.html only.

   Lets a vendor set a shipment status, carrier, and tracking
   number on any order row via the "Update shipment" modal.
   There's no backend yet, so this only updates the row's own
   UI in place (status pill, tracking line) — it resets on
   reload, matching every other mock-data page in this app.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("shipment-modal");
  const form = document.getElementById("shipment-form");
  const list = document.getElementById("order-list");
  if (!modal || !form || !list) return;

  // Human-readable label shown on the status pill for each status value —
  // "completed" reads as "delivered" here since that's the buyer-facing
  // word used on customer/orders.html's matching timeline.
  const STATUS_LABEL = {
    pending: "pending",
    processing: "processing",
    shipped: "shipped",
    "out-for-delivery": "out for delivery",
    completed: "delivered",
    cancelled: "cancelled",
  };

  const statusSelect = document.getElementById("shipment-status");
  const carrierInput = document.getElementById("shipment-carrier");
  const trackingInput = document.getElementById("shipment-tracking");
  const orderIdLabel = document.getElementById("shipment-order-id");
  const closeBtn = document.getElementById("shipment-modal-close");
  const cancelBtn = document.getElementById("shipment-cancel-btn");

  let activeRow = null;

  function openModal(row) {
    activeRow = row;
    orderIdLabel.textContent = row.querySelector(".order-id")?.textContent.trim() || "—";
    statusSelect.value = row.dataset.status || "pending";
    carrierInput.value = row.dataset.carrier || "";
    trackingInput.value = row.dataset.tracking || "";
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    activeRow = null;
  }

  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".order-manage-btn");
    if (!btn) return;
    const row = btn.closest(".order-item");
    if (row) openModal(row);
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
    if (!activeRow) return;

    const status = statusSelect.value;
    activeRow.dataset.status = status;
    activeRow.dataset.carrier = carrierInput.value.trim();
    activeRow.dataset.tracking = trackingInput.value.trim();

    const pill = activeRow.querySelector(".status-pill");
    if (pill) {
      pill.className = `status-pill ${status}`;
      pill.textContent = STATUS_LABEL[status] || status;
    }

    // The tracking line only shows once a carrier or tracking number is
    // set — add or remove it from the row rather than always rendering
    // an empty one.
    let trackingLine = activeRow.querySelector(".order-tracking-line");
    const hasTracking = activeRow.dataset.carrier || activeRow.dataset.tracking;
    if (hasTracking) {
      if (!trackingLine) {
        trackingLine = document.createElement("p");
        trackingLine.className = "order-tracking-line";
        activeRow.querySelector(".order-info")?.insertBefore(
          trackingLine,
          activeRow.querySelector(".order-manage-btn")
        );
      }
      trackingLine.textContent = [activeRow.dataset.carrier, activeRow.dataset.tracking]
        .filter(Boolean)
        .join(" · ");
    } else if (trackingLine) {
      trackingLine.remove();
    }

    closeModal();
  });
});
