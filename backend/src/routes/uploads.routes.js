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

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const ALLOWED_MIME = new Set([...IMAGE_MIME, "application/pdf", ...VIDEO_MIME]);

// A full-resolution phone photo (especially a wide store-cover banner,
// not just a square avatar) routinely runs past what the old flat 8MB
// cap allowed, forcing whoever's uploading to pre-compress it — that's
// where the visible quality loss on images actually came from, not
// anything this backend does to the file itself (no resize/recompress
// happens here — see uploadBuffer() below). 20MB clears a real
// full-res phone photo with room to spare. Video gets the same 20MB
// ceiling, per its own explicit cap — multer only enforces one
// fileSize limit for the whole route, so the video-specific case
// below is really just documentation once both caps agree; kept as
// its own constant so the two can diverge again without hunting down
// every reference.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_BYTES = Math.max(MAX_IMAGE_BYTES, MAX_VIDEO_BYTES);

const upload = multer({
  storage: multer.memoryStorage(), // no local disk — see cloudinary.js's header comment
  limits: { fileSize: MAX_BYTES },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Only JPEG/PNG/WEBP/GIF images, a PDF, or an MP4/WEBM/MOV video are allowed."));
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
