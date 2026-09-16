/* =========================================================
   Shared "write a notification row" helper — same pattern as
   activityLog.js's logActivity(), just aimed at a specific user's own
   notifications list (customer/vendor notifications.html) instead of
   the admin-facing activity feed. Called from route handlers at the
   point a state change actually happens, not trusted from a client.
   ========================================================= */

const pool = require("../db");
const { newId } = require("./id");

async function notify({ userId, type, title, message, link = null }) {
  await pool.query(
    `INSERT INTO notifications (id, user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?, ?)`,
    [newId(), userId, type, title, message, link]
  );
}

module.exports = { notify };
