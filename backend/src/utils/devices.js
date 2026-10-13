/* =========================================================
   Device tracking and bans. api-client.js sends a random per-browser
   ID in the X-Device-Id header; it's recorded against the signed-in
   account (recordDevice) and checked against banned_devices on every
   non-admin request (middleware/deviceBan.js).

   The banned list is small and read on every request, so each process
   keeps it in memory for BAN_CACHE_MS and reloads after that, or at
   once after a ban/unban made through this process.
   ========================================================= */

const pool = require("../db");
const { newId } = require("./id");
const { hashIdentifier, recordIdentifier } = require("./identifiers");

const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
const BAN_CACHE_MS = 30 * 1000;
// recordDevice() is called on every authenticated request; the write is
// skipped if this process already recorded the same pair recently.
const RECORD_INTERVAL_MS = 10 * 60 * 1000;

let bannedCache = null;
let bannedCacheAt = 0;
const recentlyRecorded = new Map();

function deviceIdFrom(req) {
  const id = String(req.get("x-device-id") || "").trim();
  return DEVICE_ID_PATTERN.test(id) ? id : null;
}

// Two sources: devices banned one by one (banned_devices, by raw ID) and
// the devices of permanently banned people (banned_identifiers, hashed).
async function bannedDevices() {
  if (bannedCache && Date.now() - bannedCacheAt < BAN_CACHE_MS) return bannedCache;
  const [rows] = await pool.query(`SELECT device_id FROM banned_devices`);
  let hashes = [];
  try {
    [hashes] = await pool.query(`SELECT value_hash FROM banned_identifiers WHERE kind = 'device'`);
  } catch {
    // Table not there yet (migration 022 pending): only single-device bans apply.
  }
  bannedCache = { ids: new Set(rows.map((r) => r.device_id)), hashes: new Set(hashes.map((r) => r.value_hash)) };
  bannedCacheAt = Date.now();
  return bannedCache;
}

function invalidateBanCache() {
  bannedCache = null;
}

async function isDeviceBanned(deviceId) {
  if (!deviceId) return false;
  const banned = await bannedDevices();
  if (banned.ids.has(deviceId)) return true;
  return banned.hashes.size > 0 && banned.hashes.has(hashIdentifier("device", deviceId));
}

async function recordDevice(userId, req) {
  const deviceId = deviceIdFrom(req);
  if (!userId || !deviceId) return;
  const key = `${userId}:${deviceId}`;
  const last = recentlyRecorded.get(key);
  if (last && Date.now() - last < RECORD_INTERVAL_MS) return;
  recentlyRecorded.set(key, Date.now());
  if (recentlyRecorded.size > 5000) recentlyRecorded.clear();
  const ip = String(req.ip || "").replace(/^::ffff:/, "").slice(0, 45) || null;
  try {
    await pool.query(
      `INSERT INTO user_devices (id, user_id, device_id, user_agent, last_ip)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_seen_at = NOW(), user_agent = VALUES(user_agent), last_ip = VALUES(last_ip)`,
      [newId(), userId, deviceId, String(req.get("user-agent") || "").slice(0, 255) || null, ip]
    );
    await recordIdentifier(userId, "device", deviceId);
  } catch (error) {
    // Never block a request over device bookkeeping (e.g. the migration
    // hasn't run yet on this database).
    console.error("Could not record device:", error.message);
  }
}

// "Chrome on Android" from a user agent, for the admin's device list.
function describeUserAgent(ua) {
  const s = String(ua || "");
  if (!s) return "Unknown device";
  const os = /Android/i.test(s) ? "Android"
    : /iPhone/i.test(s) ? "iPhone"
    : /iPad/i.test(s) ? "iPad"
    : /Windows/i.test(s) ? "Windows"
    : /Mac OS X|Macintosh/i.test(s) ? "Mac"
    : /CrOS/i.test(s) ? "Chromebook"
    : /Linux/i.test(s) ? "Linux"
    : "Unknown OS";
  const browser = /Edg\//.test(s) ? "Edge"
    : /OPR\/|Opera/.test(s) ? "Opera"
    : /SamsungBrowser/.test(s) ? "Samsung Internet"
    : /Firefox\//.test(s) ? "Firefox"
    : /CriOS|Chrome\//.test(s) ? "Chrome"
    : /Safari\//.test(s) ? "Safari"
    : "Browser";
  return `${browser} on ${os}`;
}

module.exports = { deviceIdFrom, isDeviceBanned, invalidateBanCache, recordDevice, describeUserAgent };
