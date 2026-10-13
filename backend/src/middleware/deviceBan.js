/* =========================================================
   Refuses every request from a banned device (see utils/devices.js).
   Mounted ahead of the API routes in app.js. The admin console and the
   contact form stay reachable: admins are never locked out by a device
   they banned while testing, and a banned user can still write in to
   appeal.
   ========================================================= */

const { deviceIdFrom, isDeviceBanned } = require("../utils/devices");

const EXEMPT = [/^\/api\/admin(\/|$)/, /^\/api\/health$/, /^\/api\/contact(\/|$)/, /^\/api\/payments\/webhook$/];

async function deviceBan(req, res, next) {
  if (EXEMPT.some((re) => re.test(req.path))) return next();
  // Admin sign-in shares /api/auth with everyone else.
  if (req.path === "/api/auth/admin-signin") return next();
  try {
    if (await isDeviceBanned(deviceIdFrom(req))) {
      return res.status(403).json({
        error: "This device has been banned from VETRA. If you think this is a mistake, contact support@vetrahq.org.",
        deviceBanned: true,
      });
    }
  } catch (error) {
    // Fail open if the ban table can't be read: an outage here must not
    // take the whole marketplace down with it.
    console.error("Device ban check failed:", error.message);
  }
  next();
}

module.exports = { deviceBan };
