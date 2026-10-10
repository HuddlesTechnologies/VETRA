/* =========================================================
   VETRA: Vendor earnings (vendor/earnings.html, real backend).
   Everything comes from GET /api/vendors/me/earnings
   (backend/src/routes/vendors.routes.js):

     - Total Sales      goods total of every paid order not cancelled
     - Paid Out         what Paystack has actually transferred to the
                        vendor's bank account
     - Pending Payout   what's still to come: orders whose escrow hasn't
                        released yet, or whose transfer is on its way
     - VETRA Commission the platform's cut across those orders

   Each order's payout is sent automatically when escrow releases (the
   buyer confirms, or the protection window passes): goods minus
   commission, plus the delivery fee if the vendor shipped it themselves.
   Orders from before online payments weren't paid through VETRA, so
   they're listed without a payout.
   ========================================================= */

const EARNINGS_PAYOUT_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h3v-4z" /></svg>`;

// [label, status-pill class] per payout state.
const PAYOUT_PILL = {
  success: ["paid", "completed"],
  processing: ["sending", "processing"],
  queued: ["scheduled", "pending"],
  awaiting_account: ["add bank account", "cancelled"],
  failed: ["retrying", "cancelled"],
  reversed: ["retrying", "cancelled"],
};

document.addEventListener("DOMContentLoaded", async () => {
  const user = VetraAPI.getUser("vendor");
  if (!user) return;
  await renderEarnings();
});

function formatPayoutDate(iso) {
  if (!iso) return "";
  return formatDateNG(iso, { day: "numeric", month: "short", year: "numeric" });
}

function payoutStatus(item) {
  if (!item.paidOnline) return ["not paid online", "pending", "Placed before online payments"];
  if (item.payout) {
    const [label, cls] = PAYOUT_PILL[item.payout.status] || [item.payout.status, "pending"];
    const when = item.payout.status === "success"
      ? `Sent to your bank ${formatPayoutDate(item.payout.completedAt)}`
      : item.payout.status === "awaiting_account"
        ? "Add a payout account above to receive this"
        : `Escrow released ${formatPayoutDate(item.escrowReleasedAt)}`;
    return [label, cls, when];
  }
  if (item.escrowStatus === "refunded") return ["refunded", "cancelled", "Refunded to the buyer"];
  return ["in escrow", "pending", item.status === "completed" ? "Waiting for the buyer to confirm" : "Releases after delivery"];
}

async function renderEarnings() {
  const statGrid = document.querySelector(".stat-grid");
  const historyList = document.querySelector(".vendor-section:last-of-type .order-list");

  let data;
  try {
    data = await VetraAPI.request("/vendors/me/earnings", { method: "GET", role: "vendor" });
  } catch (err) {
    const message = VetraAPI.escapeHtml(err.message);
    if (statGrid) statGrid.innerHTML = `<p class="table-empty">Couldn't load earnings: ${message}</p>`;
    if (historyList) historyList.innerHTML = `<p class="vendor-products-empty">Couldn't load payout history: ${message}</p>`;
    return;
  }

  if (statGrid) {
    const { totalSales, paidOut, pending, commission } = data.stats;
    statGrid.querySelectorAll(".stat-value").forEach((el, i) => {
      el.textContent = formatNaira([totalSales, paidOut, pending, commission][i]);
    });
  }

  if (!historyList) return;
  if (!data.items.length) {
    historyList.innerHTML = `<p class="vendor-products-empty">No sales yet. Each order shows here with its commission and payout.</p>`;
    return;
  }

  historyList.innerHTML = data.items
    .map((item) => {
      const [label, cls, detail] = payoutStatus(item);
      const breakdown = item.paidOnline && item.commission
        ? `${formatNaira(item.goods)} sale &minus; ${formatNaira(item.commission)} commission (${item.commissionPercent}%)`
        : `${formatNaira(item.goods)} sale`;
      return `
        <div class="order-item">
          <div class="stat-icon">${EARNINGS_PAYOUT_ICON}</div>
          <div class="order-info">
            <p class="order-id">${formatOrderRef({ id: item.id, tracking_code: item.trackingCode })}</p>
            <p class="order-meta">${breakdown}</p>
            <p class="order-meta">${VetraAPI.escapeHtml(detail)}</p>
          </div>
          <div class="order-side">
            <p class="order-amount">${formatNaira(item.paidOnline ? item.net : item.goods)}</p>
            <span class="status-pill ${cls}">${label}</span>
          </div>
        </div>
      `;
    })
    .join("");
}
