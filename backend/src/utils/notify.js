/* =========================================================
   Shared "write a notification row" helper, same pattern as
   activityLog.js's logActivity(), just aimed at a specific user's own
   notifications list (customer/vendor notifications.html) instead of
   the admin-facing activity feed. Called from route handlers at the
   point a state change actually happens, not trusted from a client.

   Best-effort, same reasoning as logActivity()/mailer.js's sendEmail():
   this always runs after the call site's real primary write, so a
   transient failure here must not turn an already-successful action
   into a client-visible error.
   ========================================================= */

const pool = require("../db");
const { newId } = require("./id");

async function notify({ userId, type, title, message, link = null }) {
  try {
    await pool.query(
      `INSERT INTO notifications (id, user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), userId, type, title, message, link]
    );
  } catch (error) {
    console.error("Could not write notification:", error.message);
  }
}

module.exports = { notify };
