/* =========================================================
   VETRA: Vendor reports and disputes (vendor/orders.html, real backend).
   Renders real reports filed against this store from GET /api/reports/mine
   and submits evidence via POST /api/reports/:id/evidence, the
   companion side of admin/reports.html, which is where an admin
   actually resolves or dismisses a report. See
   backend/src/routes/reports.routes.js.
   ========================================================= */

const REPORT_STATUS_BADGE = { open: "open", resolved: "resolved", dismissed: "dismissed" };

function formatReportDate(iso) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

function buildReportCard(report) {
  const hasEvidence = Boolean(report.evidence_ids);
  const card = document.createElement("div");
  card.className = "report-card";
  card.dataset.reportId = report.id;

  const actionsHtml = report.status !== "open"
    ? `<div class="report-meta-row"><span>${report.status === "resolved" ? "Resolved" : "Dismissed"} by Vetra admin${report.attended_at ? " on " + formatReportDate(report.attended_at) : ""}</span></div>`
    : hasEvidence
      ? `<div class="report-actions"><span class="badge dismissed evidence-sent-tag">Evidence submitted, awaiting review</span></div>`
      : `<div class="report-actions"><button type="button" class="btn-evidence" data-action="evidence" data-id="${report.id}">Submit evidence</button></div>`;

  card.innerHTML = `
    <div class="report-card-head">
      <div>
        <h4>Report against your store</h4>
        <p>Reported by ${report.reporter || "a buyer"}</p>
      </div>
      <span class="badge ${REPORT_STATUS_BADGE[report.status] || report.status}">${report.status}</span>
    </div>
    <p class="report-reason">"${report.reason}"</p>
    <div class="report-meta-row">
      <span>Filed ${formatReportDate(report.created_at)}</span>
    </div>
    ${actionsHtml}
  `;
  return card;
}

async function loadAndRenderReports() {
  const list = document.getElementById("report-list");
  if (!list) return;

  list.innerHTML = `<p class="vendor-products-empty">Loading reports…</p>`;
  try {
    const reports = await VetraAPI.request("/reports/mine", { method: "GET", role: "vendor" });
    if (!reports.length) {
      list.innerHTML = `<p class="vendor-products-empty">No reports filed against your store.</p>`;
      return;
    }
    list.innerHTML = "";
    reports.forEach((r) => list.appendChild(buildReportCard(r)));
  } catch (err) {
    list.innerHTML = `<p class="vendor-products-empty">Couldn't load reports: ${err.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadAndRenderReports();

  const modal = document.getElementById("evidence-modal");
  const form = document.getElementById("evidence-form");
  const list = document.getElementById("report-list");
  if (!modal || !form || !list) return;

  const textInput = document.getElementById("evidence-text");
  const closeBtn = document.getElementById("evidence-modal-close");
  const cancelBtn = document.getElementById("evidence-cancel-btn");

  let activeCard = null;

  function openModal(card) {
    activeCard = card;
    textInput.value = "";
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    textInput.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    activeCard = null;
  }

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='evidence']");
    if (!btn) return;
    const card = btn.closest(".report-card");
    if (card) openModal(card);
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
    if (!activeCard) return;

    const responseText = textInput.value.trim();
    if (!responseText) return;

    const reportId = activeCard.dataset.reportId;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await VetraAPI.request(`/reports/${reportId}/evidence`, {
        method: "POST",
        role: "vendor",
        body: { responseText },
      });

      const actions = activeCard.querySelector(".report-actions");
      if (actions) {
        actions.innerHTML = `<span class="badge dismissed evidence-sent-tag">Evidence submitted, awaiting review</span>`;
      }
      closeModal();
    } catch (err) {
      if (typeof VendorUI !== "undefined") {
        VendorUI.info({ title: "Couldn't submit evidence", bodyHtml: err.message });
      }
    } finally {
      submitBtn.disabled = false;
    }
  });
});
