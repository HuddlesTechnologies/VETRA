/* =========================================================
   VETRA — VENDOR EARNINGS (vendor/earnings.html, real backend)
   The four stat cards and the "Payout History" list used to ship as
   permanently-fake numbers/rows — nothing anywhere ever loaded real
   data into them. Real numbers computed from GET /orders/vendor
   (same real list vendor/assets/orders.js already renders), keyed off
   each order's real escrow_status (see backend/migrations/001_init.sql):

     - Total Revenue   = sum of every non-cancelled order's total
     - Available Balance = sum of orders whose escrow has been
       released — there's no separate payout/withdrawal ledger table
       in the schema, so "released" is the truest available proxy for
       "money that's actually been sent to your account"
     - Pending Payout  = sum of orders still held in escrow
     - Total Orders    = count of non-cancelled orders

   "Payout History" is real too, but it lists released/held *orders*
   rather than fabricated #PO-xxxx payout batches — the backend has no
   concept of a discrete payout event to list, so pretending otherwise
   would just be a different flavor of fake data.
   ========================================================= */

const EARNINGS_PAYOUT_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h3v-4z" /></svg>`;

document.addEventListener("DOMContentLoaded", async () => {
  const user = VetraAPI.getUser("vendor");
  if (!user) return;
  await renderEarnings();
});

function formatPayoutDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

async function renderEarnings() {
  const statGrid = document.querySelector(".stat-grid");
  const historyList = document.querySelector(".vendor-section:last-of-type .order-list");

  let orders = [];
  try {
    orders = await VetraAPI.request("/orders/vendor", { method: "GET", role: "vendor" });
  } catch (err) {
    if (statGrid) statGrid.innerHTML = `<p class="table-empty">Couldn't load earnings: ${err.message}</p>`;
    if (historyList) historyList.innerHTML = `<p class="vendor-products-empty">Couldn't load payout history: ${err.message}</p>`;
    return;
  }

  const nonCancelled = orders.filter((o) => o.status !== "cancelled");
  const released = nonCancelled.filter((o) => o.escrow_status === "released");
  const held = nonCancelled.filter((o) => o.escrow_status === "held");

  const totalRevenue = nonCancelled.reduce((sum, o) => sum + o.total, 0);
  const availableBalance = released.reduce((sum, o) => sum + o.total, 0);
  const pendingPayout = held.reduce((sum, o) => sum + o.total, 0);

  if (statGrid) {
    const values = [totalRevenue, availableBalance, pendingPayout, nonCancelled.length];
    statGrid.querySelectorAll(".stat-value").forEach((el, i) => {
      el.textContent = i < 3 ? formatNaira(values[i]) : values[i].toLocaleString();
    });
  }

  if (!historyList) return;
  const payoutRows = [...released, ...held].sort(
    (a, b) => new Date(b.escrow_released_at || b.created_at) - new Date(a.escrow_released_at || a.created_at)
  );

  if (!payoutRows.length) {
    historyList.innerHTML = `<p class="vendor-products-empty">No payouts yet — this fills in as orders are delivered and escrow releases.</p>`;
    return;
  }

  historyList.innerHTML = payoutRows
    .map((order) => {
      const isReleased = order.escrow_status === "released";
      const dateLabel = formatPayoutDate(order.escrow_released_at || order.created_at);
      return `
        <div class="order-item">
          <div class="stat-icon">${EARNINGS_PAYOUT_ICON}</div>
          <div class="order-info">
            <p class="order-id">#${order.id.slice(0, 8).toUpperCase()}</p>
            <p class="order-meta">Payout to bank account — ${dateLabel}</p>
          </div>
          <div class="order-side">
            <p class="order-amount">${formatNaira(order.total)}</p>
            <span class="status-pill ${isReleased ? "completed" : "pending"}">${isReleased ? "completed" : "pending"}</span>
          </div>
        </div>
      `;
    })
    .join("");
}
