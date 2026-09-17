/* =========================================================
   UUIDv7 instead of crypto.randomUUID()'s v4 — same 36-character
   dashed format (CHAR(36) everywhere in the schema, every route, and
   the frontend all keep working with zero changes), but the leading
   48 bits are a millisecond timestamp instead of fully random. That
   makes new ids monotonically increasing over time, so InnoDB inserts
   append to the end of each table's clustered index (like an
   auto-increment column) instead of landing at a random point and
   forcing a page split — a real, if slow-building, cost with a fully
   random UUID primary key at real insert volume. No migration needed:
   existing rows keep their old random v4 ids untouched; this only
   changes what newId() hands out from now on.
   ========================================================= */
const { randomBytes } = require("crypto");

function newId() {
  const ms = BigInt(Date.now());
  const rand = randomBytes(10); // 80 bits of randomness, same as v4's non-timestamp bits
  const bytes = Buffer.alloc(16);

  // 48-bit big-endian ms timestamp
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  // Version nibble (0111 = 7) + 12 random bits
  bytes[6] = 0x70 | (rand[0] & 0x0f);
  bytes[7] = rand[1];

  // Variant bits (10) + 62 random bits
  bytes[8] = 0x80 | (rand[2] & 0x3f);
  bytes[9] = rand[3];
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Customer-facing order tracking code (orders.tracking_code) — a
// distinct value from the order's own id, not just that id reformatted:
// every other reference display in the app shows "VTR<id prefix>" (see
// formatRef() below), while this is what a buyer is told to quote when
// tracking or contacting support. 8 base32-ish chars (Crockford's
// alphabet, no 0/O/1/I to avoid transcription mistakes when read aloud
// or typed back in) after the fixed "VTA" prefix.
const TRACKING_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function newTrackingCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += TRACKING_CODE_ALPHABET[bytes[i] % TRACKING_CODE_ALPHABET.length];
  }
  return `VTA${code}`;
}

// Every other order/report reference display — "VTR" instead of the
// old "#" prefix, same 8-character id prefix as before.
function formatRef(id) {
  return `VTR${id.slice(0, 8).toUpperCase()}`;
}

module.exports = { newId, newTrackingCode, formatRef };
