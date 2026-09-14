/* =========================================================
   Shared "write an activity_log row" helper — called from every
   route that performs a mutating action an admin should be able
   to audit later (suspend, approve, resolve a report, shipment
   update, etc.). Writing this server-side, from the route handler
   itself rather than trusting a client-supplied log call, is the
   whole point — see BACKEND_GUIDE.md §6 point 7.
   ========================================================= */

const pool = require("../db");
const { newId } = require("./id");

async function logActivity({ type, message, actorUserId = null, targetType = null, targetId = null }) {
  await pool.query(
    `INSERT INTO activity_log (id, type, message, actor_user_id, target_type, target_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newId(), type, message, actorUserId, targetType, targetId]
  );
}

module.exports = { logActivity };
