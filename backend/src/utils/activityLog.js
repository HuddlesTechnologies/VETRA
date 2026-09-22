/* =========================================================
   Shared "write an activity_log row" helper, called from every
   route that performs a mutating action an admin should be able
   to audit later (suspend, approve, resolve a report, shipment
   update, etc.). Writing this server-side, from the route handler
   itself rather than trusting a client-supplied log call, is the
   whole point, see BACKEND_GUIDE.md §6 point 7.

   Best-effort, same reasoning as mailer.js's sendEmail(): every call
   site does its real primary write (the UPDATE/INSERT that actually
   matters) BEFORE calling this, with no transaction wrapping the two
   together, a transient DB error on this INSERT must not turn an
   already-successful primary action into a client-visible 500 (which
   invites a retry that repeats the primary action, e.g. a duplicate
   report/banner). Losing one audit-trail row to a rare transient
   failure is a far smaller problem than that.
   ========================================================= */

const pool = require("../db");
const { newId } = require("./id");

async function logActivity({ type, message, actorUserId = null, targetType = null, targetId = null }) {
  try {
    await pool.query(
      `INSERT INTO activity_log (id, type, message, actor_user_id, target_type, target_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), type, message, actorUserId, targetType, targetId]
    );
  } catch (error) {
    console.error("Could not write activity log entry:", error.message);
  }
}

module.exports = { logActivity };
