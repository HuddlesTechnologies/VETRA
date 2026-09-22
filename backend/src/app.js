/* =========================================================
   VETRA API — Express app assembly. server.js starts it listening;
   this file just wires middleware + routes so it can also be
   required directly (e.g. by a future test file) without binding
   a port.
   ========================================================= */

const express = require("express");
const cors = require("cors");
const errorHandler = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth.routes");
const productsRoutes = require("./routes/products.routes");
const ordersRoutes = require("./routes/orders.routes");
const adminRoutes = require("./routes/admin.routes");
const reportsRoutes = require("./routes/reports.routes");
const reviewsRoutes = require("./routes/reviews.routes");
const vendorsRoutes = require("./routes/vendors.routes");
const siteBannersRoutes = require("./routes/site-banners.routes");
const uploadsRoutes = require("./routes/uploads.routes");
const assistantRoutes = require("./routes/assistant.routes");
const notificationsRoutes = require("./routes/notifications.routes");

const app = express();

// Render sits in front of this app, so every request otherwise arrives
// from Render's own internal IP — without this, express-rate-limit below
// would see one shared IP for every visitor and rate-limit the whole app
// as if it were one user, and login_ip_history (backend/src/routes/
// auth.routes.js's recordLoginIp) would record that same useless internal
// address for every single login instead of the real client IP (confirmed
// live: every row ever recorded was a private 10.x.x.x address — Render's
// routing has more than the one hop `trust proxy: 1` used to assume,
// so it was stopping one hop too early).
//
// 'loopback, linklocal, uniquelocal' is Express's built-in preset for
// "trust any number of hops through the standard private/reserved IP
// ranges (127.0.0.0/8, 169.254.0.0/16, 10.0.0.0/8, 172.16.0.0/12,
// 192.168.0.0/16, etc.), stop at the first address outside them" —
// correct regardless of exactly how many private-network hops Render's
// own infrastructure adds between its edge and this container, and
// still not an arbitrary chain an attacker can spoof: a real client's
// own public IP can never fall in those ranges, and a reputable edge
// proxy (Render's included) strips/overwrites whatever X-Forwarded-For
// a client sent before appending the address it actually observed, so
// nothing after the edge is attacker-controlled.
app.set("trust proxy", "loopback, linklocal, uniquelocal");

const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins.length
  ? configuredOrigins
  : ["https://vetra-vercel.vercel.app"];

app.use(
  cors({
    // Never fail open to every website when deployment configuration is
    // missing. Fall back only to this app's known production frontend.
    origin: allowedOrigins,
  })
);
app.use(express.json());

// No DB/auth dependency — lets uptime checks and the cPanel deploy step
// confirm the app itself is alive before anything else is wired up.
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/site-banners", siteBannersRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/notifications", notificationsRoutes);
// Order matters here: vendorsRoutes' own routes only ever match a single
// path segment after /api/vendors (/, /me/kyc, /:id) — a request for
// /api/vendors/<id>/reviews has an extra segment, so it falls through
// vendorsRoutes untouched and reaches reviewsRoutes below regardless of
// which is registered first; listed in this order because vendorsRoutes
// is the more general, public-facing one.
app.use("/api/vendors", vendorsRoutes);
app.use("/api/vendors/:vendorId/reviews", reviewsRoutes);
app.use("/api/assistant", assistantRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found." }));
app.use(errorHandler);

module.exports = app;
