/* =========================================================
   VETRA — ADMIN DISPLAY FORMATTERS

   Replaces admin/assets/data.js, which was a ~650-line mock
   "fake backend" (customer/vendor/report/team state, all in
   localStorage) from before the admin console was wired to the real
   backend. Every admin page now calls the real API directly — only
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

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-NG", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(iso);
  }

  // Pairs formatDate() with timeAgo() for a "10 May 2026 (3d ago)"-style
  // display — skips the "(...)" part once timeAgo() itself would fall
  // back to the same formatted date (>30 days old), which otherwise
  // rendered as a doubled date.
  function formatDateWithRelative(iso) {
    if (!iso) return "—";
    const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days >= 30) return formatDate(iso);
    return `${formatDate(iso)} (${timeAgo(iso)})`;
  }

  return { initials, formatDate, formatDateTime, formatDateWithRelative, timeAgo };
})();
