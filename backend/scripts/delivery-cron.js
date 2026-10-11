/* =========================================================
   VETRA delivery sweep: the time-based half of the delivery system
   (src/utils/delivery.js's runDeliveryCron):

     1. releases escrow on delivered orders once the buyer protection
        window (platform_settings.auto_confirm_hours, 48 by default)
        has passed, skipping any order with an open report
     2. takes back rider job offers nobody accepted within 20 minutes
     3. retries auto-assign for parcels still waiting for a rider

   and then the payments sweep (src/utils/payments.js's runPaymentsCron):

     4. gives back the stock of checkouts nobody paid for (after checking
        Paystack once, so a payment whose webhook was missed is fulfilled)
     5. sends payouts that were queued, waiting for a bank account, or
        failed and due a retry (only while automatic payouts are on)

   Safe to run repeatedly or overlapping: every step is a guarded
   UPDATE that only ever applies once. The API process also runs this
   sweep itself as a backup (src/utils/scheduledJobs.js), skipping any
   tick this script already covered.
   ========================================================= */

// Schedule it from cPanel > Cron Jobs every 10 minutes (the exact line,
// with your username and Node version filled in, is in backend/README.md):
//   */10 * * * * cd $HOME/vetra-api && $HOME/nodevenv/vetra-api/20/bin/node scripts/delivery-cron.js >> $HOME/vetra-cron.log 2>&1

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const pool = require("../src/db");
const { runScheduledSweep } = require("../src/utils/scheduledJobs");

// The delivery and payments halves run independently inside
// runScheduledSweep(), which also records the heartbeat the admin
// dashboard reads, so a cron that stops is visible there.
runScheduledSweep("cron")
  .then(({ ok, summary, errors }) => {
    const stamp = new Date().toISOString();
    console.log(`[${stamp}] sweep`, JSON.stringify(summary));
    if (!ok) {
      console.error(`[${stamp}] sweep failed:`, errors.join("; "));
      process.exitCode = 1;
    }
  })
  .catch((err) => {
    console.error(`[${new Date().toISOString()}] sweep failed:`, err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
