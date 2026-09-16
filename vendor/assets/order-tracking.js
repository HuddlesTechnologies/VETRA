/* =========================================================
   VETRA — VENDOR ORDER TRACKING & SHIPMENT UPDATES
   Page-specific script for vendor/orders.html only.

   Lets a vendor set a shipment status, carrier, and tracking
   number on any order row via the "Update shipment" modal — a
   real PATCH /api/orders/:id/shipment (see
   backend/src/routes/orders.routes.js), which also stamps the
   matching *_at timestamp and releases escrow when the status
   becomes "completed".
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
    // row.dataset.status is hyphenated for CSS (status-pill.out-for-delivery)
    // — the <select>'s own option values are already hyphenated to match,
    // same convention as the filter tabs.
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeRow) return;

    const status = statusSelect.value; // hyphenated, e.g. "out-for-delivery"
    const carrier = carrierInput.value.trim();
    const tracking = trackingInput.value.trim();
    const orderId = activeRow.dataset.orderId;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await VetraAPI.request(`/orders/${orderId}/shipment`, {
        method: "PATCH",
        role: "vendor",
        // The backend's STATUSES enum uses underscores — status.replace
        // converts the <select>'s hyphenated value back for the request.
        body: { status: status.replace(/-/g, "_"), carrier: carrier || null, trackingNumber: tracking || null },
      });

      activeRow.dataset.status = status;
      activeRow.dataset.carrier = carrier;
      activeRow.dataset.tracking = tracking;

      const pill = activeRow.querySelector(".status-pill");
      if (pill) {
        pill.className = `status-pill ${status}`;
        pill.textContent = STATUS_LABEL[status] || status;
      }

      // The tracking line only shows once a carrier or tracking number is
      // set — add or remove it from the row rather than always rendering
      // an empty one.
      let trackingLine = activeRow.querySelector(".order-tracking-line");
      const hasTracking = carrier || tracking;
      if (hasTracking) {
        if (!trackingLine) {
          trackingLine = document.createElement("p");
          trackingLine.className = "order-tracking-line";
          activeRow.querySelector(".order-info")?.insertBefore(
            trackingLine,
            activeRow.querySelector(".order-manage-btn")
          );
        }
        trackingLine.textContent = [carrier, tracking].filter(Boolean).join(" · ");
      } else if (trackingLine) {
        trackingLine.remove();
      }

      if (window.VetraVendorOrderFilters) window.VetraVendorOrderFilters.applyVisibility();
      closeModal();
    } catch (err) {
      if (typeof VendorUI !== "undefined") {
        VendorUI.info({ title: "Couldn't update shipment", bodyHtml: err.message });
      }
    } finally {
      submitBtn.disabled = false;
    }
  });
});
