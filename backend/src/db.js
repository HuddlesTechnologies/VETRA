/* =========================================================
   VETRA API — MySQL connection pool.
   One pool, shared by every route module. mysql2/promise gives
   async/await query calls directly, no extra wrapper needed.
   ========================================================= */

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

module.exports = pool;
