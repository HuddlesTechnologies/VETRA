/* =========================================================
   VETRA API: migration runner.
   Runs every .sql file in migrations/ in filename order, inside one
   connection, that hasn't already been recorded in schema_migrations
   (created here on first run). Each file's own statements still
   aren't wrapped in up/down, so a migration itself should stay
   additive (ADD COLUMN, CREATE TABLE IF NOT EXISTS, etc.), same as
   every migration in this folder already is.

   This used to just replay every file unconditionally every run,
   fine while there was exactly one (001_init.sql, all CREATE TABLE
   IF NOT EXISTS, safe to repeat) but a real problem the moment a
   second migration added a plain ALTER TABLE ADD COLUMN: re-running
   it against a database that already has that column fails outright
   (confirmed live, see 002_feature_updates.sql). Tracking what's
   already applied is what actually fixes that, not just "be careful".

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

  const ssl = process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined;

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    ssl,
  });

  try {
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    const [appliedRows] = await connection.query(`SELECT filename FROM schema_migrations`);
    const applied = new Set(appliedRows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipping ${file} (already applied).`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`Running ${file}...`);
      await connection.query(sql);
      await connection.query(`INSERT INTO schema_migrations (filename) VALUES (?)`, [file]);
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
