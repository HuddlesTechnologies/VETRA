/* =========================================================
   Every uploaded image is stored as WebP.

   toWebp() takes the uploaded bytes (JPEG, PNG, GIF, WebP, AVIF, TIFF,
   and HEIC where the server's image library supports it), turns it
   upright from the camera's orientation tag, shrinks it so its longest
   side fits the folder's limit (never enlarges), strips metadata
   (camera details and GPS location), and re-encodes it as WebP.
   Animated GIFs stay animated.

   A typical 4-8MB phone photo comes out around 150-500KB with no
   visible difference at the sizes the site shows it.
   ========================================================= */

const sharp = require("sharp");

// The host caps memory per account; one image at a time, no decode cache.
sharp.concurrency(1);
sharp.cache(false);

// Longest side, in pixels, per upload folder. Anything not listed uses
// DEFAULT_MAX_DIMENSION.
const MAX_DIMENSION = {
  avatars: 800,
  "delivery-proof": 1600,
  products: 2000,
  covers: 2400,
  banners: 2400,
  kyc: 3000, // identity documents: kept large enough to read every line
};
const DEFAULT_MAX_DIMENSION = 2000;

const QUALITY = { kyc: 90 };
const DEFAULT_QUALITY = 80;

const IMAGE_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
  "image/heic", "image/heif", "image/tiff", "image/bmp",
]);
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp)$/i;

function isImage(file) {
  return IMAGE_MIME.has(String(file.mimetype || "").toLowerCase()) || IMAGE_EXT.test(file.originalname || "");
}

/**
 * Converts an image buffer to WebP for the given upload folder.
 * Resolves to a Buffer. Rejects with a user-readable Error if the file
 * isn't an image the server can read.
 */
// iPhone photos (and Samsung phones set to "high efficiency") are HEIC.
// sharp's bundled libheif only reads AVIF, so HEIC is decoded by
// heic-decode (pure JavaScript, nothing to compile on the host) into
// raw pixels sharp can take from there.
function isHeic(buffer) {
  if (!buffer || buffer.length < 12 || buffer.toString("latin1", 4, 8) !== "ftyp") return false;
  return /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(buffer.toString("latin1", 8, 12));
}

async function decodeHeic(buffer) {
  const decode = require("heic-decode");
  const { width, height, data } = await decode({ buffer });
  // HEIC stores rotation as a transform the decoder already applies.
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } });
}

async function toWebp(buffer, folder) {
  const maxSide = MAX_DIMENSION[folder] || DEFAULT_MAX_DIMENSION;
  const quality = QUALITY[folder] || DEFAULT_QUALITY;
  try {
    let input;
    let animated = false;
    let loop = 0;
    if (isHeic(buffer)) {
      input = await decodeHeic(buffer);
    } else {
      input = sharp(buffer, { animated: true, failOn: "error" });
      const meta = await input.metadata();
      animated = (meta.pages || 1) > 1;
      loop = meta.loop ?? 0;
      input = input.rotate(); // apply the EXIF orientation, then drop the tag
    }
    return await input
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 4, ...(animated ? { loop } : {}) })
      .toBuffer();
  } catch (error) {
    console.error(`[images] could not convert upload (${buffer ? buffer.length : 0} bytes):`, error.message);
    const err = new Error("That image couldn't be read. Try a JPEG or PNG photo.");
    err.status = 400;
    err.cause = error;
    throw err;
  }
}

module.exports = { toWebp, isImage, IMAGE_MIME };
