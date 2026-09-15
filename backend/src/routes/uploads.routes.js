/* =========================================================
   /api/uploads — accepts a real file and returns a real URL,
   closing the one gap left in every route that currently takes an
   `imageUrl`/`idDocumentUrl`/`cacDocumentUrl` as a pre-hosted string
   (site-banners, vendor KYC, and — via the same route — vendor/
   customer/admin avatar + cover photos, product images). See
   BACKEND_GUIDE.md §7 step 8.

   One generic route rather than one per feature: every caller just
   needs "a file in, a URL out." `folder` groups uploads in
   Cloudinary's dashboard (kyc/, banners/, avatars/, products/, etc.)
   for readability — it has no effect on access control, since
   Cloudinary URLs are public by default the same way any image CDN
   URL is; that's fine for product photos and banners, and matches
   what the KYC feature already accepts today (a public, if
   unguessable, URL) rather than a bigger access-control feature
   nothing has asked for.
   ========================================================= */

const express = require("express");
const multer = require("multer");
const cloudinary = require("../utils/cloudinary");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
const MAX_BYTES = 8 * 1024 * 1024; // 8MB — comfortably above a phone photo, well under free-tier limits

const upload = multer({
  storage: multer.memoryStorage(), // no local disk — see cloudinary.js's header comment
  limits: { fileSize: MAX_BYTES },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Only JPEG/PNG/WEBP/GIF images or a PDF are allowed."));
    }
    cb(null, true);
  },
});

function uploadBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `vetra/${folder}`, resource_type: "auto" },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

router.post(
  "/",
  requireAuth,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "file is required." });

    // Free-text, not an enum — this only organizes the Cloudinary
    // dashboard, so an unrecognized value just lands in its own
    // folder rather than being rejected.
    const folder = (req.body.folder || "misc").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "misc";

    const result = await uploadBuffer(req.file.buffer, folder);
    res.status(201).json({ url: result.secure_url });
  })
);

module.exports = router;
