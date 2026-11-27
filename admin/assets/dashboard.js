/* =========================================================
   VETRA: Admin dashboard (admin/dashboard.html, real backend).
   Renders the KPI stat grid, recent-activity feed, and pending-
   vendor-applications preview table from GET /api/admin/stats,
   /activity, and /vendors?status=pending. Super Admins also get a
   Flutterwave balance card (GET /api/admin/balance, which the
   backend refuses for every other role).
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;

  await Promise.all([renderStats(), renderActivity(), renderPendingVendors(), renderKycManualReview()]);
});

async function renderStats() {
  const grid = document.getElementById("admin-stats");
  if (!grid) return;

  // Fetched alongside the stats, but a Flutterwave failure only affects its
  // own card, never the rest of the grid.
  const balanceRequest = can("payments.view")
    ? VetraAPI.request("/admin/balance", { method: "GET", role: "admin" }).catch((err) => ({ error: err.message }))
    : null;

  let s;
  try {
    s = await VetraAPI.request("/admin/stats", { method: "GET", role: "admin" });
  } catch (err) {
    grid.innerHTML = `<p class="table-empty">Couldn't load stats: ${VetraAPI.escapeHtml(err.message)}</p>`;
    return;
  }
  renderSweepHealth(s.sweep);
  const manualReviewCount = document.getElementById("dashboard-kyc-review-count");
  if (manualReviewCount) manualReviewCount.textContent = s.kycManualReview.toLocaleString();

  const cards = [
    {
      label: "Total Customers",
      value: s.totalCustomers.toLocaleString(),
      tint: "blue",
      href: "customers.html",
      sub: `${s.suspendedCustomers} suspended`,
      icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle>',
    },
    {
      label: "Total Vendors",
      value: s.totalVendors.toLocaleString(),
      tint: "purple",
      href: "vendors.html",
      sub: `${s.pendingVendors} pending approval`,
      icon: '<path d="M3 9l1.5-5h15L21 9"></path><path d="M4 9v10a1 1 0 0 0 1 1h4v-6h6v6h4a1 1 0 0 0 1-1V9"></path>',
    },
    {
      label: "Platform Orders",
      value: s.platformOrders.toLocaleString(),
      tint: "blue",
      href: "deliveries.html",
      icon: '<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"></path><path d="M8 7h8M8 11h8M8 15h5"></path>',
    },
    {
      label: "Platform Revenue",
      value: formatNaira(s.platformRevenue),
      tint: "green",
      // Same gate as the Payments sidebar link.
      href: can("payments.view") ? "payments.html" : null,
      icon: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h3v-4z"></path>',
    },
    {
      label: "Suspended Accounts",
      value: s.suspendedAccounts.toLocaleString(),
      tint: "red",
      href: "customers.html?filter=suspended",
      sub: `${s.suspendedCustomers} customers · ${s.suspendedVendors} vendors`,
      icon: '<circle cx="12" cy="12" r="10"></circle><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"></line>',
    },
    {
      label: "New Messages",
      value: (s.newMessages || 0).toLocaleString(),
      tint: "blue",
      href: "messages.html",
      sub: '<span style="color: var(--c-accent)">Open inbox</span>',
      icon: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline>',
    },
    {
      label: "Open Reports",
      value: s.openReports.toLocaleString(),
      tint: "amber",
      href: "reports.html?filter=open",
      icon: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="4"></line>',
    },
  ];

  if (balanceRequest) cards.push(balanceCard(await balanceRequest));

  // Cards with an href render as links so tapping one opens its page.
  grid.innerHTML = cards
    .map(
      (c) => `
    <${c.href ? `a href="${c.href}"` : "div"} class="stat-card${c.href ? " stat-card-link" : ""}">
      <div class="stat-card-head">
        <p class="stat-label">${c.label}</p>
        <span class="stat-icon tint-${c.tint}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${c.icon}</svg>
        </span>
      </div>
      <p class="stat-value">${c.value}</p>
      ${c.sub ? `<span class="stat-trend" style="color: var(--muted)">${c.sub}</span>` : ""}
    </${c.href ? "a" : "div"}>
  `
    )
    .join("");
}

// The background sweep fails silently otherwise: escrow, rider offers,
// and payout retries just stop. Nothing renders while it's healthy.
function renderSweepHealth(health) {
  const banner = document.getElementById("sweep-health-banner");
  if (!banner || !health) return;
  if (health.status === "ok") {
    if (!health.cronMissing) return;
    // Running, but only on the API's own backup timer, which stops
    // whenever the site goes quiet: the red banner comes back then.
    const lastCron = health.lastCronSuccessAt
      ? `The cron job last completed a run at ${new Date(health.lastCronSuccessAt).toLocaleString()}.`
      : "The cron job hasn't completed a run since this check was added.";
    banner.innerHTML = `
      <div role="status" style="border: 1px solid var(--c-orange); background: var(--c-orange-tint); border-radius: 12px; padding: 14px 16px; margin: 0 0 20px; color: var(--c-text);">
        <strong style="color: var(--c-orange);">The cron job isn't running. The API's backup is covering for now.</strong>
        <p style="margin: 6px 0 0; font-size: 13px;">${lastCron} The backup only runs while the site has visitors, so overnight and on quiet days escrow, rider offers and payout retries will pause. In cPanel → Cron Jobs, check the VETRA entry is there and runs <code>/bin/bash $HOME/vetra-api/scripts/run-sweep.sh</code> every 10 minutes, then look at <code>~/vetra-cron.log</code>.</p>
      </div>`;
    banner.hidden = false;
    return;
  }

  let last = health.lastSuccessAt
    ? `Last successful run: ${new Date(health.lastSuccessAt).toLocaleString()}.`
    : "It has never completed a run.";
  // Started recently but never finished: runs are hanging, not missing.
  if (health.status === "stale" && health.lastStartedAt && new Date(health.lastStartedAt) > new Date(health.lastSuccessAt || 0)) {
    last += ` A run started at ${new Date(health.lastStartedAt).toLocaleString()} but didn't finish.`;
  }
  const headline = {
    never_run: "The background job hasn't run yet.",
    stale: `The background job hasn't run in over ${health.staleAfterMinutes} minutes.`,
    failing: `The background job is failing (${health.consecutiveFailures} run${health.consecutiveFailures === 1 ? "" : "s"} in a row).`,
  }[health.status] || "The background job needs attention.";
  const error = health.status === "failing" && health.lastError
    ? `<pre style="white-space: pre-wrap; font-size: 12px; margin: 8px 0 0;">${VetraAPI.escapeHtml(health.lastError)}</pre>`
    : "";

  banner.innerHTML = `
    <div role="alert" style="border: 1px solid var(--c-red); background: var(--c-red-tint); border-radius: 12px; padding: 14px 16px; margin: 0 0 20px; color: var(--c-text);">
      <strong style="color: var(--c-red);">${headline}</strong>
      <p style="margin: 6px 0 0; font-size: 13px;">${last} Until it runs, escrow isn't auto-released, unaccepted rider offers aren't taken back, waiting parcels aren't re-assigned, and failed payouts aren't retried. Check the cron job and the server log.</p>
      ${error}
    </div>`;
  banner.hidden = false;
}

function balanceCard(result) {
  const card = {
    label: "Flutterwave Balance",
    tint: "green",
    href: "payments.html",
    icon: '<rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line>',
  };
  if (result.error) {
    return { ...card, value: "Unavailable", sub: VetraAPI.escapeHtml(result.error) };
  }
  const ngn = result.balances.find((b) => b.currency === "NGN");
  const others = result.balances.filter((b) => b.currency !== "NGN");
  const notes = [
    result.mode === "test" ? "Test mode" : "Live",
    ...others.map((b) => `${b.currency} ${(b.balance / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`),
    `as of ${new Date(result.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
  ];
  return { ...card, value: formatNaira(ngn ? ngn.balance : 0), sub: notes.join(" · ") };
}

async function renderActivity() {
  const container = document.getElementById("dashboard-activity-feed");
  if (!container) return;

  try {
    // Role-scoped server-side already (Super Admin sees everything;
    // Moderator/Support see platform events + their own actions only),
    // see backend/src/routes/admin.routes.js's GET /activity.
    const rows = await VetraAPI.request("/admin/activity", { method: "GET", role: "admin" });
    const entries = rows.slice(0, 6).map((r) => ({
      type: r.type,
      message: r.message,
      actorName: r.actor_name || null,
      time: r.created_at,
    }));
    AdminUI.renderActivityFeed(container, entries);
  } catch (err) {
    container.innerHTML = `<p class="table-empty">Couldn't load activity: ${VetraAPI.escapeHtml(err.message)}</p>`;
  }
}

let lastRenderedPendingVendors = [];

async function renderKycManualReview() {
  const tbody = document.querySelector("#dashboard-kyc-review-table tbody");
  const countEl = document.getElementById("dashboard-kyc-review-count");
  if (!tbody || !countEl) return;
  try {
    const rows = await VetraAPI.request("/admin/vendors?kycStatus=manual_review", { method: "GET", role: "admin" });
    tbody.innerHTML = rows.length
      ? rows.slice(0, 6).map((vendor) => `
          <tr>
            <td>
              <p class="cell-title">${VetraAPI.escapeHtml(vendor.store_name || "—")}</p>
              <p class="cell-sub">${VetraAPI.escapeHtml(vendor.name || "—")}</p>
            </td>
            <td class="cell-muted">${VetraAPI.escapeHtml(vendor.kyc_provider_reason || "Provider verification failed.")}</td>
            <td><a class="btn-view" href="vendor-detail.html?id=${vendor.id}" style="text-decoration: none;">Review</a></td>
          </tr>
        `).join("")
      : `<tr><td colspan="3" class="table-empty">No KYC cases need manual review.</td></tr>`;
  } catch (err) {
    countEl.textContent = "!";
    tbody.innerHTML = `<tr><td colspan="3" class="table-empty">Couldn't load KYC review cases: ${VetraAPI.escapeHtml(err.message)}</td></tr>`;
  }
}

async function renderPendingVendors() {
  const tbody = document.querySelector("#dashboard-pending-table tbody");
  if (!tbody) return;

  let pending;
  try {
    pending = await VetraAPI.request("/admin/vendors?status=pending", { method: "GET", role: "admin" });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">Couldn't load pending vendors: ${VetraAPI.escapeHtml(err.message)}</td></tr>`;
    return;
  }

  if (!pending.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No pending vendor applications.</td></tr>`;
    return;
  }

  tbody.innerHTML = pending
    .slice(0, 4)
    .map(
      (v) => `
    <tr data-vendor-id="${v.id}">
      <td>
        <div class="cell-entity">
          ${VetraAdmin.avatarMarkup(v.avatar_url, v.store_name)}
          <div>
            <p class="cell-title">${VetraAPI.escapeHtml(v.store_name || "")}</p>
            <p class="cell-sub">${VetraAPI.escapeHtml(v.name || "")}</p>
          </div>
        </div>
      </td>
      <td class="cell-muted">${v.store_category || "—"}</td>
      <td class="cell-muted">Pending review</td>
      <td>
        <div class="table-actions">
          ${
            can("vendors.status")
              ? `<button class="btn-approve" data-action="approve" data-id="${v.id}">Approve</button>
                 <button class="btn-reject" data-action="reject" data-id="${v.id}">Reject</button>`
              : `<span class="cell-muted">View only</span>`
          }
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  // `pending` here is a fresh array each call, keep a module-level
  // reference the (once-attached, see below) click handler can read.
  lastRenderedPendingVendors = pending;
}

// Attached once, not inside renderPendingVendors(), that function re-runs
// after every approve/reject, and re-innerHTML'ing tbody doesn't replace
// the tbody element itself, so a listener attached inside it would stack
// a new copy on every re-render (the original mock had this same bug:
// a second action after the first would fire once per prior render).
document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.querySelector("#dashboard-pending-table tbody");
  if (!tbody) return;

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const vendor = lastRenderedPendingVendors.find((v) => v.id === id);
    if (!vendor) return;
    const storeName = VetraAPI.escapeHtml(vendor.store_name || "");

    async function setStatus(status, reason) {
      try {
        await VetraAPI.request(`/admin/vendors/${id}/status`, {
          method: "PATCH", role: "admin", body: { status, reason },
        });
        await Promise.all([renderPendingVendors(), renderStats(), renderActivity()]);
      } catch (err) {
        AdminUI.info({ title: "Couldn't update vendor", bodyHtml: err.message });
      }
    }

    if (btn.dataset.action === "approve") {
      AdminUI.confirm({
        title: "Approve vendor",
        bodyHtml: `Approve <span class="confirm-modal-target">${storeName}</span>? Their store and listings will go live immediately.`,
        confirmLabel: "Approve",
        onConfirm: () => setStatus("active"),
      });
    } else if (btn.dataset.action === "reject") {
      AdminUI.confirm({
        title: "Reject vendor application",
        bodyHtml: `Reject <span class="confirm-modal-target">${storeName}</span>'s application? They can re-apply later.`,
        confirmLabel: "Reject",
        danger: true,
        showReason: true,
        onConfirm: (reason) => setStatus("rejected", reason),
      });
    }
  });
});
