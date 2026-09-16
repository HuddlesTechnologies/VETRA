/* =========================================================
   Google Sign-In — verifies the ID token Google Identity Services
   hands back client-side (see signin.js/signup.js's
   handleGoogleCredential()) against Google's own public keys. Only
   needs GOOGLE_CLIENT_ID (public — it's embedded in the frontend too),
   never a Client Secret, since verifying an ID token's signature isn't
   the same as the server-side OAuth code-exchange flow.
   ========================================================= */

const { OAuth2Client } = require("google-auth-library");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Throws if the token is malformed, expired, or wasn't issued for this
// app's Client ID — callers should let that propagate to asyncHandler's
// error middleware rather than catching it themselves.
async function verifyGoogleIdToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload.email_verified) {
    throw new Error("Google account email is not verified.");
  }
  return {
    email: payload.email,
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture || null,
  };
}

module.exports = { verifyGoogleIdToken };
