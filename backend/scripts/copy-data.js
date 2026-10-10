/* =========================================================
   VETRA: one-time data copy between two MySQL databases, for moving
   off Clever Cloud onto cPanel's own MySQL (see backend/README.md,
   "Moving to cPanel").

   SOURCE is read from SOURCE_DB_* env vars (the old database).
   TARGET is the normal DB_* settings from backend/.env (the new one).

   Run `npm run migrate` against the TARGET first, so it has the full,
   current schema. This script then copies rows only: every table that
   exists in the source (except schema_migrations), using only columns
   that exist on both sides, so a target that's a migration or two
   ahead (new columns get their defaults) is fine.

   Values are copied as raw strings (dateStrings) so DATETIMEs move
   byte-for-byte with no timezone conversion on the way through. JSON
   columns are re-serialised. Every table's row count is compared at
   the end, and the script exits non-zero on any mismatch.

   Usage:
     SOURCE_DB_HOST=... SOURCE_DB_PORT=3306 SOURCE_DB_USER=... \
     SOURCE_DB_PASSWORD=... SOURCE_DB_NAME=... SOURCE_DB_SSL=true \
     node scripts/copy-data.js --yes

   The target's copied tables are emptied first. Without --yes it only
   prints what it would do.
   ========================================================= */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const BATCH = 500;
const SKIP_TABLES = new Set(["schema_migrations"]);

function connect(prefix) {
  const env = (k) => process.env[`${prefix}${k}`];
  if (!env("HOST") || !env("NAME") || !env("USER")) {
    throw new Error(`${prefix}HOST, ${prefix}NAME and ${prefix}USER must be set.`);
  }
  return mysql.createConnection({
    host: env("HOST"),
    port: Number(env("PORT") || 3306),
    user: env("USER"),
    password: env("PASSWORD"),
    database: env("NAME"),
    ssl: env("SSL") === "true" ? { rejectUnauthorized: false } : undefined,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

async function columnsOf(conn, table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS type FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows;
}

async function main() {
  const apply = process.argv.includes("--yes");
  const source = await connect("SOURCE_DB_");
  const target = await connect("DB_");
  console.log(`Source: ${process.env.SOURCE_DB_HOST}/${process.env.SOURCE_DB_NAME}`);
  console.log(`Target: ${process.env.DB_HOST}/${process.env.DB_NAME}`);
  if (process.env.SOURCE_DB_HOST === process.env.DB_HOST && process.env.SOURCE_DB_NAME === process.env.DB_NAME) {
    throw new Error("Source and target are the same database.");
  }

  try {
    const [targetMigrations] = await target.query(`SELECT filename FROM schema_migrations`).catch(() => [[]]);
    if (!targetMigrations.length) throw new Error("Target has no schema. Run `npm run migrate` against it first.");

    const [tableRows] = await source.query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
    );
    const tables = tableRows.map((r) => r.name).filter((t) => !SKIP_TABLES.has(t));
    const plan = [];
    for (const table of tables) {
      const targetCols = await columnsOf(target, table);
      if (!targetCols.length) {
        console.warn(`  ! ${table}: not in target schema, skipped. Is the target fully migrated?`);
        continue;
      }
      const sourceCols = await columnsOf(source, table);
      const targetNames = new Set(targetCols.map((c) => c.name));
      const shared = sourceCols.filter((c) => targetNames.has(c.name));
      const [[{ n }]] = await source.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      plan.push({ table, shared, count: Number(n) });
      const dropped = sourceCols.filter((c) => !targetNames.has(c.name)).map((c) => c.name);
      console.log(`  ${table}: ${n} rows${dropped.length ? ` (not in target, dropped: ${dropped.join(", ")})` : ""}`);
    }

    if (!apply) {
      console.log("\nDry run. Re-run with --yes to empty these target tables and copy.");
      return;
    }

    await target.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const { table, shared, count } of plan) {
      await target.query(`DELETE FROM \`${table}\``);
      const names = shared.map((c) => `\`${c.name}\``).join(", ");
      const jsonCols = new Set(shared.filter((c) => c.type === "json").map((c) => c.name));
      for (let offset = 0; offset < count; offset += BATCH) {
        // ORDER BY the first column (every table here leads with its
        // primary key) so batches are stable.
        const [rows] = await source.query(
          `SELECT ${names} FROM \`${table}\` ORDER BY 1 LIMIT ? OFFSET ?`,
          [BATCH, offset]
        );
        if (!rows.length) break;
        const values = rows.map((row) =>
          shared.map((c) => {
            const v = row[c.name];
            return jsonCols.has(c.name) && v !== null && typeof v !== "string" ? JSON.stringify(v) : v;
          })
        );
        await target.query(`INSERT INTO \`${table}\` (${names}) VALUES ?`, [values]);
      }
      process.stdout.write(`  copied ${table}\n`);
    }
    await target.query("SET FOREIGN_KEY_CHECKS = 1");

    console.log("\nVerifying row counts:");
    let mismatches = 0;
    for (const { table, count } of plan) {
      const [[{ n }]] = await target.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      const ok = Number(n) === count;
      if (!ok) mismatches += 1;
      console.log(`  ${ok ? "ok " : "MISMATCH"} ${table}: source ${count}, target ${n}`);
    }
    if (mismatches) {
      process.exitCode = 1;
      console.error(`\n${mismatches} table(s) don't match. Don't switch traffic over yet.`);
    } else {
      console.log("\nAll tables match.");
    }
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error("Copy failed:", err.message);
  process.exit(1);
});
