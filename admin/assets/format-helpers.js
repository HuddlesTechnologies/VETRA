/* =========================================================
   VETRA: Admin display formatters.

   Replaces admin/assets/data.js, which was a ~650-line mock
   "fake backend" (customer/vendor/report/team state, all in
   localStorage) from before the admin console was wired to the real
   backend. Every admin page now calls the real API directly, only
   these five pure, stateless display helpers were still actually
   used anywhere, so this is what's left. Kept as `VetraAdmin.*` so
   every existing call site (customers.js, vendors.js, dashboard.js,
   reports.js, customer-detail.js, vendor-detail.js, settings.js,
   ui.js) needed zero changes.
   ========================================================= */

const VetraAdmin = (() => {
  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  // Real photo when one's on file, falling back to the initials text
  // otherwise, same choice settings.js's team list already makes. The
  // onerror swap covers a stored avatar_url that fails to load (e.g. an
  // expired Google photo), not just a missing one. Just the inner
  // content, for dropping into an existing .cell-avatar element
  // (customer-detail.html/vendor-detail.html's static markup).
  function avatarInnerMarkup(avatarUrl, name) {
    const initialsText = initials(name);
    if (!avatarUrl) return initialsText;
    const safeUrl = VetraAPI.escapeHtml(avatarUrl);
    return `<img src="${safeUrl}" alt="" onerror="this.parentElement.textContent='${initialsText}';" />`;
  }

  // Same as above, but wrapped in its own .cell-avatar span, for a list
  // row that doesn't already have that container in its static markup.
  function avatarMarkup(avatarUrl, name) {
    return `<span class="cell-avatar">${avatarInnerMarkup(avatarUrl, name)}</span>`;
  }

  // Africa/Lagos explicitly (see api-client.js's VETRA_TIME_ZONE note),
  // without it these fall back to the *viewer's own* device
  // timezone, not Nigeria's, despite the "en-NG" locale argument only
  // ever having controlled formatting style, never the actual clock.
  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-NG", { timeZone: VETRA_TIME_ZONE, month: "short", day: "numeric", year: "numeric" });
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-NG", {
      timeZone: VETRA_TIME_ZONE,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // More detailed past the hour mark ("3h 24m ago", not just "3h
  // ago"). The diff itself is timezone-agnostic (it's a duration,
  // not a clock reading), only the formatDate() fallback below
  // actually needs Africa/Lagos.
  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs < 24) return remMins ? `${hrs}h ${remMins}m ago` : `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(iso);
  }

  // Pairs formatDate() with timeAgo() for a "10 May 2026 (3d ago)"-style
  // display, skips the "(...)" part once timeAgo() itself would fall
  // back to the same formatted date (>30 days old), which otherwise
  // rendered as a doubled date.
  function formatDateWithRelative(iso) {
    if (!iso) return "—";
    const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days >= 30) return formatDate(iso);
    return `${formatDate(iso)} (${timeAgo(iso)})`;
  }

  return { initials, avatarMarkup, avatarInnerMarkup, formatDate, formatDateTime, formatDateWithRelative, timeAgo };
})();
