/* =========================================================
   Escapes a string for safe interpolation into an HTML string that
   will later be set via innerHTML somewhere in the frontend (activity
   log messages, report reasons, notification text — none of these
   go through a templating engine that escapes automatically, and
   several of them are rendered with `el.innerHTML = value` directly).

   Used at the point a user-controlled string (a vendor's store name,
   a product name, a buyer's report reason, an admin's typed reason)
   gets written into a field that's later rendered as HTML, not at
   render time — that way every current and future consumer of that
   stored value is safe by construction, without needing to remember
   to escape it again each place it's displayed. Found live: a
   vendor's store name or a buyer's report reason could otherwise
   contain a real `<script>`/`<img onerror=...>` payload that would
   execute in an admin's or vendor's own authenticated session the
   moment they viewed the activity log, reports queue, or
   notifications — a stored XSS reachable by anyone who can sign up.
   ========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = { escapeHtml };
