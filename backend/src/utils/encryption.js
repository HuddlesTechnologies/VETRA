/* =========================================================
   AES-256-GCM encrypt/decrypt for at-rest secrets that need to be
   read back later (unlike a password, which only ever needs
   comparing — see utils/password.js for that case). Used for
   users.payout_account_number_enc — see BACKEND_GUIDE.md §3's
   "never store the raw account number in plaintext" note.

   ENCRYPTION_KEY can be any non-empty string, not necessarily hex —
   it's hashed down to a 32-byte AES-256 key rather than used
   directly, deliberately, so it works whether you generate it
   yourself (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
   or let Render's Blueprint auto-generate one (render.yaml's
   generateValue: true, which doesn't guarantee a hex string).
   ========================================================= */

const crypto = require("crypto");

function getKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY must be set — see src/utils/encryption.js's header comment.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

// Output shape: "<iv-hex>:<authTag-hex>:<ciphertext-hex>" — a single
// string so it fits in one VARCHAR column without a second field.
function encrypt(plainText) {
  const iv = crypto.randomBytes(12); // 96-bit IV is the GCM-recommended size
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

function decrypt(stored) {
  const [ivHex, authTagHex, ciphertextHex] = String(stored).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
  return plain.toString("utf8");
}

module.exports = { encrypt, decrypt };
