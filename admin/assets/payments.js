/* =========================================================
   VETRA: Admin payments (admin/payments.html, Super Admin only).
   Backed by backend/src/routes/admin.routes.js's /payments, /payouts,
   /refunds, /orders/:id/refund and /paystack/balance, every one of
   which refuses any other admin role, server-side.

   - Payout settings: the commission % and the automatic-payouts switch.
   - Payouts: every transfer to a vendor or rider, with Retry and
     Cancel on the ones that haven't gone through.
   - Payments in: each buyer checkout and what Paystack charged.
   - Refunds: manual refunds for disputes, and the refund history, with
     Retry and Cancel on failed ones (after checking Paystack, since a
     timed-out refund may have gone through).
   ========================================================= */

const esc = (value) => VetraAPI.escapeHtml(value == null ? "" : String(value));

const PAYOUT_STATUS = {
  success: ["Paid", "completed"],
  processing: ["Sending", "processing"],
  queued: ["Scheduled", "pending"],
  awaiting_account: ["No bank account", "cancelled"],
  failed: ["Failed", "cancelled"],
  reversed: ["Reversed", "cancelled"],
  cancelled: ["Cancelled", "cancelled"],
};
const PAYMENT_STATUS = {
  success: ["Paid", "completed"],
  initialized: ["Awaiting payment", "pending"],
  abandoned: ["Abandoned", "cancelled"],
  failed: ["Failed", "cancelled"],
};
const REFUND_STATUS = {
  processed: ["Refunded", "completed"],
  processing: ["Processing", "processing"],
  failed: ["Failed", "cancelled"],
  cancelled: ["Cancelled", "cancelled"],
};

function pill([label, cls]) {
  return `<span class="status-pill ${cls}">${esc(label)}</span>`;
}

function emptyRow(table, columns, message) {
  table.querySelector("tbody").innerHTML = `<tr><td colspan="${columns}" class="table-empty">${esc(message)}</td></tr>`;
}

const api = (path, opts = {}) => VetraAPI.request(path, { role: "admin", ...opts });

let payoutFilter = "";
let payouts = [];

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;
  if (!isSuperAdmin()) {
    document.querySelector(".page-shell").innerHTML = `<p class="table-empty">Payments are only available to Super Admins.</p>`;
    return;
  }
  wireTabs();
  wireSettings();
  wireRefundForm();
  wireRowActions();
  await Promise.all([loadSettings(), loadPayouts(), loadPayments(), loadRefunds()]);
  renderStats();
});

// ---------- Stats ----------

let balanceResult = null;

async function renderStats() {
  const grid = document.getElementById("payments-stats");
  if (!balanceResult) {
    balanceResult = await api("/admin/paystack/balance").catch((err) => ({ error: err.message }));
  }
  const ngn = balanceResult.balances?.find((b) => b.currency === "NGN");
  const sum = (status) => payouts.filter((p) => p.status === status).reduce((total, p) => total + p.amount, 0);
  const waiting = payouts.filter((p) => ["queued", "processing", "awaiting_account", "failed"].includes(p.status));
  const cards = [
    {
      label: "Paystack Balance",
      value: balanceResult.error ? "Unavailable" : formatNaira(ngn ? ngn.balance : 0),
      sub: balanceResult.error ? esc(balanceResult.error) : balanceResult.mode === "test" ? "Test mode" : "Live",
    },
    { label: "Paid Out", value: formatNaira(sum("success")), sub: "Across the payouts below" },
    { label: "Waiting to Pay", value: formatNaira(waiting.reduce((total, p) => total + p.amount, 0)), sub: `${waiting.length} payout${waiting.length === 1 ? "" : "s"}` },
    { label: "Failed", value: payouts.filter((p) => p.status === "failed").length.toLocaleString(), sub: "Retried automatically, up to 5 times" },
  ];
  grid.innerHTML = cards
    .map((c) => `
      <div class="stat-card">
        <div class="stat-card-head"><p class="stat-label">${c.label}</p></div>
        <p class="stat-value">${c.value}</p>
        <span class="stat-trend" style="color: var(--muted)">${c.sub}</span>
      </div>`)
    .join("");
}

// ---------- Settings ----------

async function loadSettings() {
  try {
    const s = await api("/admin/payments/settings");
    document.getElementById("set-commission").value = s.commissionPercent;
    document.getElementById("set-auto-payouts").checked = s.autoPayoutsEnabled;
  } catch (err) {
    AdminUI.info({ title: "Couldn't load payment settings", bodyHtml: esc(err.message) });
  }
}

function wireSettings() {
  const form = document.getElementById("payments-settings-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const body = {
      commissionPercent: Number(document.getElementById("set-commission").value || 0),
      autoPayoutsEnabled: document.getElementById("set-auto-payouts").checked,
    };
    const save = async () => {
      try {
        await api("/admin/payments/settings", { method: "PATCH", body });
        AdminUI.info({ title: "Saved", bodyHtml: body.autoPayoutsEnabled ? "Payment settings saved. Payouts that were waiting are being sent now." : "Payment settings saved." });
        payoutFilter = "";
        await loadPayouts();
        renderStats();
      } catch (err) {
        AdminUI.info({ title: "Couldn't save", bodyHtml: esc(err.message) });
      }
    };
    if (body.autoPayoutsEnabled) {
      AdminUI.confirm({
        title: "Send payouts automatically?",
        bodyHtml: "Real money will leave the Paystack balance: riders when they complete a delivery, vendors when escrow releases. Anything scheduled now goes out straight away. Make sure transfer OTP is off in the Paystack dashboard and the balance can cover it.",
        confirmLabel: "Turn on and save",
        onConfirm: save,
      });
    } else {
      save();
    }
  });
}

// ---------- Tabs ----------

function wireTabs() {
  document.getElementById("payments-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tab");
    if (!btn) return;
    document.querySelectorAll("#payments-tabs .filter-tab").forEach((t) => t.classList.toggle("active", t === btn));
    ["payouts", "payments", "refunds"].forEach((name) => {
      document.getElementById(`tab-${name}`).hidden = btn.dataset.tab !== name;
    });
  });
  document.getElementById("payout-status-filter").addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tab");
    if (!btn) return;
    document.querySelectorAll("#payout-status-filter .filter-tab").forEach((t) => t.classList.toggle("active", t === btn));
    payoutFilter = btn.dataset.status;
    renderPayouts();
  });
}

// ---------- Payouts ----------

async function loadPayouts() {
  const table = document.getElementById("payouts-table");
  try {
    payouts = await api("/admin/payouts");
    renderPayouts();
  } catch (err) {
    emptyRow(table, 6, `Couldn't load payouts: ${err.message}`);
  }
}

function renderPayouts() {
  const table = document.getElementById("payouts-table");
  const rows = payoutFilter ? payouts.filter((p) => p.status === payoutFilter) : payouts;
  if (!rows.length) return emptyRow(table, 6, payoutFilter ? "Nothing here." : "No payouts yet. They appear as deliveries complete and escrow releases.");
  table.querySelector("tbody").innerHTML = rows
    .map((p) => {
      const retryable = ["failed", "queued", "awaiting_account"].includes(p.status);
      return `
        <tr>
          <td><p class="cell-title">${esc(p.payee_store || p.payee_name)}</p><p class="cell-sub">${p.kind === "rider" ? "Rider" : "Vendor"}${p.payee_bank ? ` &middot; ${esc(p.payee_bank)}` : ""}</p></td>
          <td>${esc(p.tracking_code || "—")}</td>
          <td>${formatNaira(p.amount)}</td>
          <td>${pill(PAYOUT_STATUS[p.status] || [p.status, "pending"])}${
            p.status === "cancelled"
              ? `<p class="cell-sub">${p.cancelled_by_name ? `By ${esc(p.cancelled_by_name)}: ` : ""}${esc(p.cancel_reason || "")}</p>`
              : p.failure_reason ? `<p class="cell-sub">${esc(p.failure_reason)}</p>` : ""
          }${p.attempts > 1 ? `<p class="cell-sub">${p.attempts} attempts</p>` : ""}</td>
          <td class="cell-muted">${VetraAdmin.formatDateTime(p.cancelled_at || p.completed_at || p.sent_at || p.created_at)}</td>
          <td>${retryable ? `<div class="table-actions">
            <button type="button" class="btn-view" data-action="retry-payout" data-id="${esc(p.id)}">Retry</button>
            <button type="button" class="btn-suspend" data-action="cancel-payout" data-id="${esc(p.id)}">Cancel</button>
          </div>` : ""}</td>
        </tr>`;
    })
    .join("");
}

// ---------- Payments in ----------

async function loadPayments() {
  const table = document.getElementById("payments-table");
  try {
    const rows = await api("/admin/payments");
    if (!rows.length) return emptyRow(table, 6, "No payments yet.");
    table.querySelector("tbody").innerHTML = rows
      .map((p) => `
        <tr>
          <td><p class="cell-title">${esc(p.buyer_name || p.email)}</p><p class="cell-sub">${esc(p.email)}</p></td>
          <td>${esc(p.tracking_codes || "—")}</td>
          <td>${formatNaira(p.amount)}${p.channel ? `<p class="cell-sub">${esc(p.channel)}</p>` : ""}</td>
          <td class="cell-muted">${formatNaira(p.processing_fee)}</td>
          <td>${pill(PAYMENT_STATUS[p.status] || [p.status, "pending"])}</td>
          <td class="cell-muted">${VetraAdmin.formatDateTime(p.paid_at || p.created_at)}</td>
        </tr>`)
      .join("");
  } catch (err) {
    emptyRow(table, 6, `Couldn't load payments: ${err.message}`);
  }
}

// ---------- Refunds ----------

async function loadRefunds() {
  const table = document.getElementById("refunds-table");
  try {
    const rows = await api("/admin/refunds");
    if (!rows.length) return emptyRow(table, 6, "No refunds yet.");
    table.querySelector("tbody").innerHTML = rows
      .map((r) => `
        <tr>
          <td><p class="cell-title">${esc(r.tracking_code || "No order")}</p><p class="cell-sub">${esc(r.email)}</p></td>
          <td>${formatNaira(r.amount)}</td>
          <td class="cell-muted">${esc(r.reason || "—")}</td>
          <td>${pill(REFUND_STATUS[r.status] || [r.status, "pending"])}${
            r.status === "cancelled"
              ? `<p class="cell-sub">${r.cancelled_by_name ? `By ${esc(r.cancelled_by_name)}: ` : ""}${esc(r.cancel_reason || "")}</p>`
              : r.failure_reason ? `<p class="cell-sub">${esc(r.failure_reason)}</p>` : ""
          }</td>
          <td class="cell-muted">${VetraAdmin.formatDateTime(r.cancelled_at || r.completed_at || r.created_at)}</td>
          <td>${r.status === "failed" ? `<div class="table-actions">
            <button type="button" class="btn-view" data-action="retry-refund" data-id="${esc(r.id)}">Retry</button>
            <button type="button" class="btn-suspend" data-action="cancel-refund" data-id="${esc(r.id)}">Cancel</button>
          </div>` : ""}</td>
        </tr>`)
      .join("");
  } catch (err) {
    emptyRow(table, 6, `Couldn't load refunds: ${err.message}`);
  }
}

function wireRefundForm() {
  const form = document.getElementById("refund-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const order = document.getElementById("refund-order").value.trim();
    const amountNaira = document.getElementById("refund-amount").value.trim();
    const reason = document.getElementById("refund-reason").value.trim();
    const body = { reason, ...(amountNaira ? { amount: nairaToKobo(amountNaira) } : {}) };
    AdminUI.confirm({
      title: "Refund the buyer?",
      bodyHtml: `${amountNaira ? `<strong>₦${esc(Number(amountNaira).toLocaleString("en-NG"))}</strong>` : "<strong>Everything</strong> the buyer paid (goods and delivery)"} goes back to the card or bank account they paid with for <strong>${esc(order)}</strong>. ${amountNaira ? "It comes out of what the vendor is paid." : "The vendor won't be paid for this order."} This can't be undone.`,
      confirmLabel: "Refund",
      danger: true,
      onConfirm: async () => {
        try {
          const result = await api(`/admin/orders/${encodeURIComponent(order)}/refund`, { method: "POST", body });
          form.reset();
          AdminUI.info({
            title: result.status === "failed" ? "Refund failed" : "Refund sent",
            bodyHtml: result.status === "failed" ? esc(result.failureReason) : `${formatNaira(result.amount)} is on its way back to the buyer.`,
          });
          await loadRefunds();
        } catch (err) {
          AdminUI.info({ title: "Couldn't refund", bodyHtml: esc(err.message) });
        }
      },
    });
  });
}

// ---------- Row actions ----------

function wireRowActions() {
  document.querySelector(".page-shell").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === "retry-payout") {
      btn.disabled = true;
      api(`/admin/payouts/${encodeURIComponent(id)}/retry`, { method: "POST" })
        .then((result) => {
          if (result.status === "failed") AdminUI.info({ title: "Still failing", bodyHtml: esc(result.failureReason) });
          return loadPayouts().then(renderStats);
        })
        .catch((err) => AdminUI.info({ title: "Couldn't retry", bodyHtml: esc(err.message) }))
        .finally(() => {
          btn.disabled = false;
        });
    }
    if (btn.dataset.action === "cancel-payout") {
      const payout = payouts.find((p) => p.id === id);
      AdminUI.confirm({
        title: "Cancel this payout?",
        bodyHtml: `${payout ? `<strong>${formatNaira(payout.amount)}</strong> to <span class="confirm-modal-target">${esc(payout.payee_store || payout.payee_name)}</span>` : "This payout"} won't be sent or retried again. They'll be told it was cancelled, with your reason. If it was already attempted, Paystack is checked first, and a transfer that went through can't be cancelled.`,
        confirmLabel: "Cancel payout",
        danger: true,
        requireReason: true,
        onConfirm: async (reason) => {
          try {
            await api(`/admin/payouts/${encodeURIComponent(id)}/cancel`, { method: "POST", body: { reason } });
          } catch (err) {
            AdminUI.info({ title: "Couldn't cancel", bodyHtml: esc(err.message) });
          }
          await loadPayouts();
          renderStats();
        },
      });
    }
    if (btn.dataset.action === "cancel-refund") {
      AdminUI.confirm({
        title: "Cancel this refund?",
        bodyHtml: "It won't be retried, and the amount stops counting as refunded on the order, so it no longer shows on the buyer's order page and the order can be refunded again later. First check the Paystack dashboard (Transactions, then this payment's refunds) that it didn't already go through. If Paystack later confirms it did, it's recorded as refunded after all.",
        confirmLabel: "Cancel refund",
        danger: true,
        requireReason: true,
        onConfirm: async (reason) => {
          try {
            await api(`/admin/refunds/${encodeURIComponent(id)}/cancel`, { method: "POST", body: { reason } });
          } catch (err) {
            AdminUI.info({ title: "Couldn't cancel", bodyHtml: esc(err.message) });
          }
          await loadRefunds();
        },
      });
    }
    if (btn.dataset.action === "retry-refund") {
      AdminUI.confirm({
        title: "Retry this refund?",
        bodyHtml: "First check the Paystack dashboard (Transactions, then this payment's refunds) that it didn't already go through. A refund that timed out may still have been made, and retrying would refund the buyer twice.",
        confirmLabel: "I've checked, retry",
        onConfirm: async () => {
          try {
            const result = await api(`/admin/refunds/${encodeURIComponent(id)}/retry`, { method: "POST" });
            if (result.status === "failed") AdminUI.info({ title: "Still failing", bodyHtml: esc(result.failureReason) });
            await loadRefunds();
          } catch (err) {
            AdminUI.info({ title: "Couldn't retry", bodyHtml: esc(err.message) });
          }
        },
      });
    }
  });
}
