/* =========================================================
   VETRA API — MySQL connection pool.
   One pool, shared by every route module. mysql2/promise gives
   async/await query calls directly, no extra wrapper needed.
   ========================================================= */

const mysql = require("mysql2/promise");

// Most free/managed MySQL hosts (Clever Cloud, Aiven, PlanetScale, etc.)
// require TLS and reject a plaintext connection outright — shared hosting's
// `localhost` MySQL never needed this, so it's opt-in via DB_SSL rather
// than always-on. `rejectUnauthorized: false` is deliberate here: most of
// these hosts issue certs from a chain Node doesn't bundle a root for, and
// the connection is already to a specific host/port/credential set you
// control, not an arbitrary public endpoint — this still gets you
// encryption-in-transit, just not full chain verification. Tighten this
// (a real CA bundle via DB_SSL_CA) if a host you move to needs it.
const ssl = process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  ssl,
});

module.exports = pool;
