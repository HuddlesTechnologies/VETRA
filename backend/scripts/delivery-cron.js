/* =========================================================
   VETRA delivery sweep: the time-based half of the delivery system
   (src/utils/delivery.js's runDeliveryCron):

     1. releases escrow on delivered orders once the buyer protection
        window (platform_settings.auto_confirm_hours, 48 by default)
        has passed, skipping any order with an open report
     2. takes back rider job offers nobody accepted within 20 minutes
     3. retries auto-assign for parcels still waiting for a rider

   Safe to run repeatedly or overlapping: every step is a guarded
   UPDATE that only ever applies once.
   ========================================================= */

// Schedule it from cPanel > Cron Jobs every 10 minutes (the exact line,
// with your username and Node version filled in, is in backend/README.md):
//   */10 * * * * cd $HOME/vetra-api && $HOME/nodevenv/vetra-api/20/bin/node scripts/delivery-cron.js >> $HOME/vetra-cron.log 2>&1

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const pool = require("../src/db");
const { runDeliveryCron } = require("../src/utils/delivery");

runDeliveryCron()
  .then((summary) => {
    console.log(`[${new Date().toISOString()}] delivery sweep`, JSON.stringify(summary));
  })
  .catch((err) => {
    console.error(`[${new Date().toISOString()}] delivery sweep failed:`, err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
