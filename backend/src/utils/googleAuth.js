/* =========================================================
   Google Sign-In — verifies the access token Google Identity
   Services' OAuth2 token client returns client-side (see
   google-signin.js's requestAccessToken() call) by asking Google's
   own userinfo endpoint who it belongs to, rather than an ID-token
   JWT verification. This is the token-client flow specifically
   because it's the one that reliably opens a real popup from a
   genuine click on an existing custom-styled button — the
   `google.accounts.id` One Tap/credential flow is designed for a
   Google-rendered button and can't be reliably triggered the same
   way. Either flow only ever needs GOOGLE_CLIENT_ID (public), never
   a Client Secret.
   ========================================================= */

// Throws if the token is invalid/expired or Google's email isn't
// verified — callers should let that propagate to asyncHandler's error
// middleware rather than catching it themselves.
async function verifyGoogleAccessToken(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error("Invalid or expired Google access token.");
  }
  const payload = await res.json();
  if (!payload.email_verified) {
    throw new Error("Google account email is not verified.");
  }
  return {
    email: payload.email,
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture || null,
  };
}

module.exports = { verifyGoogleAccessToken };
