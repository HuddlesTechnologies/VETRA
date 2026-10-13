/* =========================================================
   The scheduled sweep (delivery + payments) plus the bookkeeping
   that makes a stopped or failing sweep visible instead of silent.

   Every run, whoever triggers it (scripts/delivery-cron.js, POST
   /api/delivery/cron, or the in-process timer below), goes through
   runScheduledSweep(), which:

     - runs the delivery and payments sweeps independently, so one
       failing no longer stops the other (escrow release erroring used
       to skip every payout retry in the same run)
     - records a heartbeat in job_runs (migrations/019_job_runs.sql)
     - emails Super Admins once when the sweep fails twice in a row,
       and again only after it has recovered and failed again

   getSweepHealth() turns that heartbeat into ok / stale / failing /
   never_run for the admin dashboard and GET /api/health/jobs.
   ========================================================= */

const pool = require("../db");
const { sendEmail } = require("./mailer");
const { escapeHtml } = require("./escapeHtml");

const JOB_NAME = "sweep";
const INTERVAL_MINUTES = 10;
// Three missed runs before the dashboard calls it stale, so one slow or
// skipped run doesn't raise a false alarm.
const STALE_AFTER_MINUTES = 30;
const ALERT_AFTER_FAILURES = 2;

// The heartbeat must never be the reason a sweep fails, e.g. while a
// deploy is briefly ahead of its migration and job_runs doesn't exist.
async function safeQuery(sql, params) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.error("[sweep] heartbeat write failed:", error.message);
    return null;
  }
}

async function alertAdmins(errors) {
  const [admins] = await pool.query(
    `SELECT email FROM users WHERE role = 'admin' AND admin_role = 'Super Admin' AND status = 'active'`
  );
  const list = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  for (const admin of admins) {
    await sendEmail({
      to: admin.email,
      subject: "VETRA background job is failing",
      html: `<p>The scheduled sweep has failed ${ALERT_AFTER_FAILURES} times in a row. Until it recovers, escrow isn't auto-released, unaccepted rider offers aren't taken back, riders aren't re-assigned, and failed payouts aren't retried.</p><ul>${list}</ul><p>Check the server log, or the banner on the admin dashboard. You'll get another email only if it recovers and then fails again.</p>`,
      logFallback: `sweep failure alert for ${admin.email}: ${errors.join("; ")}`,
    });
  }
}

async function runScheduledSweep(source = "cron") {
  // Required lazily: delivery.js and payments.js already require each
  // other, and this module is loaded by server.js at startup.
  const delivery = require("./delivery");
  const payments = require("./payments");

  await safeQuery(
    `INSERT INTO job_runs (name, last_started_at, last_source) VALUES (?, NOW(), ?)
     ON DUPLICATE KEY UPDATE last_started_at = NOW(), last_source = VALUES(last_source)`,
    [JOB_NAME, source]
  );

  const summary = {};
  const errors = [];
  // Escrow releases first, so the vendor payouts they queue go out in
  // the same run.
  try {
    Object.assign(summary, await delivery.runDeliveryCron());
  } catch (error) {
    errors.push(`delivery sweep: ${error.message}`);
  }
  try {
    summary.payments = await payments.runPaymentsCron();
  } catch (error) {
    errors.push(`payments sweep: ${error.message}`);
  }

  const ok = errors.length === 0;
  if (ok) {
    await safeQuery(
      `UPDATE job_runs SET last_finished_at = NOW(), last_success_at = NOW(), last_error = NULL,
         last_summary = ?, consecutive_failures = 0, alerted_at = NULL
       WHERE name = ?`,
      [JSON.stringify(summary), JOB_NAME]
    );
  } else {
    await safeQuery(
      `UPDATE job_runs SET last_finished_at = NOW(), last_error = ?, last_summary = ?,
         consecutive_failures = consecutive_failures + 1
       WHERE name = ?`,
      [errors.join("\n"), JSON.stringify(summary), JOB_NAME]
    );
    // Claim the alert with a guarded UPDATE so overlapping runners send
    // it once between them.
    const claimed = await safeQuery(
      `UPDATE job_runs SET alerted_at = NOW()
       WHERE name = ? AND alerted_at IS NULL AND consecutive_failures >= ?`,
      [JOB_NAME, ALERT_AFTER_FAILURES]
    );
    if (claimed && claimed.affectedRows) {
      await alertAdmins(errors).catch((error) => console.error("[sweep] failure alert failed:", error.message));
    }
  }
  return { ok, summary, errors };
}

async function getSweepHealth() {
  const rows = await safeQuery(
    `SELECT last_started_at, last_finished_at, last_success_at, last_source, last_error, consecutive_failures,
       TIMESTAMPDIFF(MINUTE, last_success_at, NOW()) AS minutes_since_success
     FROM job_runs WHERE name = ?`,
    [JOB_NAME]
  );
  const row = rows && rows[0];
  if (!row || !row.last_success_at) {
    return { status: row && row.consecutive_failures ? "failing" : "never_run", lastSuccessAt: null, lastError: row ? row.last_error : null, consecutiveFailures: row ? row.consecutive_failures : 0, staleAfterMinutes: STALE_AFTER_MINUTES };
  }
  let status = "ok";
  if (row.consecutive_failures > 0) status = "failing";
  else if (row.minutes_since_success > STALE_AFTER_MINUTES) status = "stale";
  return {
    status,
    lastSuccessAt: row.last_success_at,
    lastFinishedAt: row.last_finished_at,
    lastSource: row.last_source,
    minutesSinceSuccess: row.minutes_since_success,
    consecutiveFailures: row.consecutive_failures,
    lastError: row.last_error,
    staleAfterMinutes: STALE_AFTER_MINUTES,
  };
}

/**
 * Backup runner inside the API process, so the sweep keeps happening
 * even when no external cron is set up (or it quietly stops). Skips a
 * tick when another runner started one in the last few minutes, so
 * with a working cron it does nothing. Off with IN_PROCESS_SWEEP=false.
 *
 * It only runs while the process is awake, and Passenger stops idle
 * apps after a few minutes, so the cPanel cron job running
 * scripts/delivery-cron.js stays the real runner.
 */
function startInProcessSweep() {
  if (process.env.IN_PROCESS_SWEEP === "false") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const recent = await safeQuery(
        `SELECT 1 FROM job_runs WHERE name = ? AND last_started_at > NOW() - INTERVAL ? MINUTE`,
        [JOB_NAME, INTERVAL_MINUTES - 2]
      );
      if (recent && recent.length) return;
      const result = await runScheduledSweep("in-process");
      if (result.ok) console.log(`[${new Date().toISOString()}] in-process sweep`, JSON.stringify(result.summary));
      else console.error(`[${new Date().toISOString()}] in-process sweep failed:`, result.errors.join("; "));
    } catch (error) {
      console.error("[sweep] in-process run failed:", error.message);
    } finally {
      running = false;
    }
  };
  // First run a minute after boot, once the pool and mailer are settled.
  setTimeout(tick, 60 * 1000);
  setInterval(tick, INTERVAL_MINUTES * 60 * 1000);
}

module.exports = { runScheduledSweep, getSweepHealth, startInProcessSweep, STALE_AFTER_MINUTES };
