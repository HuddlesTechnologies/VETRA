/* bcryptjs (pure JS) rather than bcrypt (native binding) — deliberate,
   since a native module needs a compiler toolchain that shared hosting's
   Node selector doesn't reliably offer. Slower per-hash than the native
   version, but at this app's auth volume that's not a real cost. */
const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 10;

function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
