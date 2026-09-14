/* =========================================================
   VETRA API — migration runner.
   Deliberately simple: runs every .sql file in migrations/ in
   filename order, inside one connection, statement by statement
   (mysql2 doesn't multi-statement by default, which is the safer
   setting to leave on). No up/down, no migration-history table —
   this project has one schema file today (001_init.sql); revisit
   this script if/when there's a second migration to apply on top
   of a database that already ran the first one.

   Run with: npm run migrate
   ========================================================= */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function main() {
  const migrationsDir = path.join(__dirname, "..", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (!files.length) {
    console.log("No migration files found in migrations/.");
    return;
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`Running ${file}...`);
      await connection.query(sql);
      console.log(`  done.`);
    }
    console.log("Migrations complete.");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
