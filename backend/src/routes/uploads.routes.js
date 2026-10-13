/* =========================================================
   /api/uploads: a file in, a URL out, for every upload in the apps
   (product photos and video, avatars, store covers, site banners,
   delivery proof photos, vendor KYC documents).

   Files are stored on this cPanel account's own disk, see
   utils/storage.js. `folder` (products, avatars, kyc...) is a
   sub-folder name; "kyc" is the one that matters, it's stored
   privately and only reachable through a signed, expiring link
   (GET /api/uploads/private/..., below).
   ========================================================= */

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const storage = require("../utils/storage");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { uploadLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const ALLOWED_MIME = new Set([...IMAGE_MIME, "application/pdf", ...VIDEO_MIME]);

// A full-resolution phone photo (especially a wide store-cover banner,
// not just a square avatar) routinely runs past what the old flat 8MB
// cap allowed, forcing whoever's uploading to pre-compress it, that's
// where the visible quality loss on images actually came from, not
// anything this backend does to the file itself (no resize/recompress
// happens here, see uploadBuffer() below). 20MB clears a real
// full-res phone photo with room to spare, and video gets the same cap.
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

// KYC (ID and CAC) documents: any document type (scans, PDFs, Word files,
// HEIC photos...) except video, up to 50MB, since vendors upload whatever
// form their certificate came in.
const MAX_KYC_BYTES = 50 * 1024 * 1024;

function isVideo(file) {
  return /^video\//i.test(file.mimetype) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp|wmv|flv|mpe?g)$/i.test(file.originalname || "");
}

function folderOf(req) {
  return (req.body.folder || "misc").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "misc";
}

const upload = multer({
  storage: multer.memoryStorage(), // written to its final place by storage.saveUpload()
  limits: { fileSize: Math.max(MAX_MEDIA_BYTES, MAX_KYC_BYTES) },
  fileFilter(req, file, cb) {
    // api-client.js sends `folder` before the file, so it's known here.
    if (folderOf(req) === "kyc") {
      if (isVideo(file)) return cb(new Error("Videos can't be used for verification. Upload a photo, scan or document instead."));
      return cb(null, true);
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Only JPEG/PNG/WEBP/GIF images, a PDF, or an MP4/WEBM/MOV video are allowed."));
    }
    cb(null, true);
  },
});

router.post(
  "/",
  requireAuth,
  uploadLimiter,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err?.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "That file is too large. The limit is 50MB for verification documents and 20MB for everything else." });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "file is required." });

    // Free-text, not an enum: an unrecognized value just becomes its own
    // sub-folder rather than being rejected.
    const folder = folderOf(req);
    if (folder === "kyc" && req.user.role !== "vendor") {
      return res.status(403).json({ error: "Only vendors can upload KYC documents." });
    }
    if (folder === "kyc" && isVideo(req.file)) {
      return res.status(400).json({ error: "Videos can't be used for verification. Upload a photo, scan or document instead." });
    }
    if (folder !== "kyc" && !ALLOWED_MIME.has(req.file.mimetype)) {
      return res.status(400).json({ error: "Only JPEG/PNG/WEBP/GIF images, a PDF, or an MP4/WEBM/MOV video are allowed." });
    }
    if (folder !== "kyc" && req.file.size > MAX_MEDIA_BYTES) {
      return res.status(413).json({ error: "That file is too large. The limit is 20MB." });
    }

    const isPrivate = folder === "kyc";
    const { url, key } = await storage.saveUpload(req.file, { folder, isPrivate });
    // A KYC document's stored `url` can't be opened as-is; `viewUrl` is a
    // signed link for showing it right away.
    res.status(201).json({ url, key, ...(isPrivate ? { viewUrl: storage.signedUrl(url) } : {}) });
  })
);

// Serves a private (KYC) file to whoever holds a signed link, which only
// GET /api/vendors/me/kyc (the vendor themselves) and the admin vendor
// routes hand out. No bearer token is needed, so the link works when an
// admin opens it in a new tab; it stops working when it expires.
router.get(
  /^\/private\/(.+)$/,
  (req, res) => {
    const key = req.params[0];
    const filePath = storage.verifyPrivateRequest(key, req.query.expires, req.query.sig);
    if (!filePath) return res.status(403).json({ error: "This link has expired. Reload the page to get a new one." });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found." });
    res.set({
      "Content-Type": storage.contentTypeFor(key),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Shown in the browser when it can (PDF, images), downloaded otherwise.
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    res.sendFile(filePath);
  }
);

module.exports = router;
