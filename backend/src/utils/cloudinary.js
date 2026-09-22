/* =========================================================
   Cloudinary config, the object-storage swap-in BACKEND_GUIDE.md
   §7 step 8 called for. Picked over cPanel's local disk (the guide's
   original default) because this backend's free-tier deploy target
   (Render) has no persistent disk on its free plan, files written
   to the container's local filesystem vanish on every restart/deploy.
   Cloudinary's free tier needs no card and is a two-line SDK call,
   so it's the swap-in here regardless of hosting target, not just a
   Render workaround.
   ========================================================= */

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

module.exports = cloudinary;
