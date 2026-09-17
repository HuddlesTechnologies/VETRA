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

// Every managed/shared MySQL plan caps how many connections one database
// account may hold open at once (Clever Cloud's test-environment plan
// currently caps this account at 5; whatever shared host this moves to
// next will have its own, likely different, cap) — a pool limit above
// that cap means the app itself starts failing requests with
// ER_USER_LIMIT_REACHED the moment real traffic needs more simultaneous
// connections than the account allows. Configurable via env instead of
// hardcoded so moving hosts is a config change, not a code change: set
// DB_CONNECTION_LIMIT to a value at or below whatever the new host's
// actual connection cap is (check its control panel/docs — cPanel-based
// shared hosting typically documents this per plan tier).
const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 5);

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit,
  // dateStrings was previously true, which made every DATETIME column
  // (created_at, expires_at, etc.) come back as a naive
  // "YYYY-MM-DD HH:mm:ss" string with no timezone marker. This server
  // and this database both run in UTC, but the values are always
  // real Nigeria-local wall-clock instants for anyone actually using
  // the site — a browser there parses that naive string as ITS OWN
  // local time (WAT, UTC+1), silently shifting every timestamp an
  // hour into the past. That's exactly why the activity feed showed
  // "1h ago" for something that happened a few minutes ago: the true
  // elapsed time plus the 1-hour misparse pushed it past the "<60
  // minutes" branch. Real JS Date objects (the mysql2 default)
  // serialize via JSON as a proper "...Z"-suffixed UTC string, which
  // every browser parses correctly regardless of its own timezone —
  // no code here depended on these fields being strings.
  ssl,
});

module.exports = pool;
