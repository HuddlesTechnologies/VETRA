/* =========================================================
   Push notifications: every in-app notification (utils/notify.js) is
   also sent to the phones and computers where that user turned
   notifications on, so it shows on the lock screen even with VETRA
   closed. Standard Web Push (VAPID), so it works in Chrome, Edge,
   Firefox and Samsung Internet on Android and desktop, and on iPhone
   and iPad (iOS 16.4+) once VETRA is added to the Home Screen.

   Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env (generate a pair
   once with `npx web-push generate-vapid-keys`). Without them push is
   off: the apps hide the "Turn on notifications" prompt and nothing is
   sent. Keep the same pair forever; a new pair silently invalidates
   every existing subscription.

   Best-effort like notify(): a push that fails never fails the action
   that caused it. Subscriptions the browser vendor reports as gone
   (404/410: the user turned notifications off or uninstalled the app)
   are deleted.
   ========================================================= */

const crypto = require("crypto");
const pool = require("../db");
const { newId } = require("./id");

let webpush = null;
function client() {
  if (webpush) return webpush;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  webpush = require("web-push");
  const subject = process.env.VAPID_SUBJECT || process.env.FRONTEND_URL || "https://vetrahq.org";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return webpush;
}

function isConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function publicKey() {
  return isConfigured() ? process.env.VAPID_PUBLIC_KEY : null;
}

const hashOf = (endpoint) => crypto.createHash("sha256").update(endpoint).digest("hex");

// Push services are only ever these hosts; anything else is refused so a
// client can't make this server POST to an arbitrary URL.
const PUSH_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

/** Validates a PushSubscription JSON from the browser. Returns it cleaned, or null. */
function parseSubscription(input) {
  if (!input || typeof input !== "object") return null;
  const endpoint = String(input.endpoint || "");
  const keys = input.keys || {};
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || endpoint.length > 2000) return null;
  if (!PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  const p256dh = String(keys.p256dh || "");
  const auth = String(keys.auth || "");
  if (!/^[A-Za-z0-9_-]{20,200}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}={0,2}$/.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

async function saveSubscription(userId, subscription, userAgent) {
  const hash = hashOf(subscription.endpoint);
  await pool.query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, endpoint_hash, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth),
       user_agent = VALUES(user_agent), last_seen_at = NOW()`,
    [newId(), userId, subscription.endpoint, hash, subscription.keys.p256dh, subscription.keys.auth, String(userAgent || "").slice(0, 255) || null]
  );
}

async function removeSubscription(userId, endpoint) {
  await pool.query(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?`, [userId, hashOf(String(endpoint || ""))]);
}

// Notification links are stored relative to the user's own app folder
// ("orders.html"), the way the in-app list uses them, so the push needs
// the folder added to open the right page.
const APP_FOLDER = { buyer: "customer", vendor: "vendor", rider: "rider", admin: "admin" };

function absoluteLink(role, link) {
  const site = (process.env.FRONTEND_URL || "https://vetrahq.org").replace(/\/+$/, "");
  const folder = APP_FOLDER[role] || "customer";
  const base = `${site}/${folder}/`;
  const fallback = role === "rider" ? `${base}index.html` : role === "admin" ? `${base}dashboard.html` : `${base}notifications.html`;
  if (!link || link === "#") return fallback;
  try {
    const url = new URL(String(link), base);
    // Only ever this site: a stored link is never allowed to send people elsewhere.
    return url.origin === new URL(site).origin ? url.href : fallback;
  } catch {
    return fallback;
  }
}

// Titles and messages are stored as escaped HTML for the in-app list
// (some carry <strong>); a lock-screen notification is plain text.
function plainText(value, max) {
  const text = String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Sends still in flight, so a short-lived script (the cron) can wait for
// them before closing the database pool.
const pending = new Set();

async function deliver(userId, { title, message, link, type }) {
  const push = client();
  if (!push) return;
  const [subs] = await pool.query(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth, u.role
     FROM push_subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.user_id = ?`,
    [userId]
  );
  if (!subs.length) return;
  const payload = (role) => JSON.stringify({
    title: plainText(title, 80) || "VETRA",
    body: plainText(message, 240),
    url: absoluteLink(role, link),
    // Same type replaces the previous one on the lock screen only for
    // job offers, where the old one is stale; others stack.
    tag: type === "delivery" && role === "rider" ? "vetra-rider-job" : undefined,
  });
  await Promise.all(subs.map(async (sub) => {
    try {
      await push.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload(sub.role),
        { TTL: 24 * 60 * 60, urgency: type === "delivery" ? "high" : "normal", timeout: 10000 }
      );
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await pool.query(`DELETE FROM push_subscriptions WHERE id = ?`, [sub.id]).catch(() => {});
      } else {
        console.error(`[push] send failed (${error.statusCode || error.code || "error"}):`, error.body || error.message);
      }
    }
  }));
}

/** Fire-and-forget: never throws, never delays the caller. */
function sendToUser(userId, notification) {
  if (!isConfigured() || !userId) return;
  const job = deliver(userId, notification)
    .catch((error) => console.error("[push] could not send:", error.message))
    .finally(() => pending.delete(job));
  pending.add(job);
}

/** Waits for every push started so far (used by scripts before exiting). */
async function flush() {
  await Promise.allSettled([...pending]);
}

module.exports = { isConfigured, publicKey, parseSubscription, saveSubscription, removeSubscription, sendToUser, flush, absoluteLink, plainText };
