/* =========================================================
   One-time: records the identifiers (email, phone, devices, KYC ID and
   CAC, payout bank account) of every existing account into
   user_identifiers, so bans and linked-account checks cover people who
   signed up before identifier tracking existed. New activity is
   recorded as it happens; this only catches up.

   --cards also asks Paystack for the card fingerprint of every past
   successful payment (one API call each, paced), so a banned buyer's
   old cards are blocked too.

   Safe to run again. Run on the server, from the app folder:
     cd ~/vetra-api && $HOME/nodevenv/vetra-api/20/bin/node scripts/backfill-identifiers.js --cards
   ========================================================= */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const pool = require("../src/db");
const { collectIdentifiers } = require("../src/utils/identifiers");
const paystack = require("../src/utils/paystack");

async function main() {
  if (process.argv.includes("--cards")) {
    const [payments] = await pool.query(
      `SELECT id, reference FROM payments WHERE status = 'success' AND card_signature IS NULL`
    );
    console.log(`Looking up cards for ${payments.length} past payment(s)...`);
    let found = 0;
    for (const p of payments) {
      try {
        const verified = await paystack.verifyTransaction(p.reference);
        if (verified.cardSignature) {
          await pool.query(`UPDATE payments SET card_signature = ? WHERE id = ?`, [verified.cardSignature, p.id]);
          found += 1;
        }
      } catch (err) {
        console.log(`  ${p.reference}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 250)); // stay well under Paystack's rate limit
    }
    console.log(`  ${found} card(s) found.`);
  }

  const [users] = await pool.query(`SELECT id FROM users WHERE role <> 'admin' AND status <> 'deleted'`);
  console.log(`Recording identifiers for ${users.length} account(s)...`);
  let done = 0;
  for (const u of users) {
    await collectIdentifiers(u.id);
    done += 1;
    if (done % 100 === 0) console.log(`  ${done}/${users.length}`);
  }
  const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM user_identifiers`);
  console.log(`Done. ${count.n} identifier(s) on record.`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
