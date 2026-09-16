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

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
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
