/* =========================================================
   Google Sign-In, verifies the access token Google Identity
   Services' OAuth2 token client returns client-side (see
   google-signin.js's requestAccessToken() call) in two steps:

   1. tokeninfo: confirms the token was actually issued for *this*
      app's GOOGLE_CLIENT_ID, not some other app's. Skipping this
      would mean any valid Google access token proves nothing more
      than "a real Google user granted email/profile access to
      *some* app", a token obtained by an unrelated app could be
      replayed here to impersonate that user's email on VETRA.
   2. userinfo: the actual profile (email, name, picture) once step
      1 confirms the token is legitimately ours.

   Only ever needs GOOGLE_CLIENT_ID (public, it's embedded in the
   frontend too), never a Client Secret.
   ========================================================= */

// Same public Client ID google-signin.js embeds. The fallback keeps Google
// sign-in working on a server whose .env never got GOOGLE_CLIENT_ID (the
// cPanel move left it unset, so every Google sign-in was rejected).
const DEFAULT_GOOGLE_CLIENT_ID = "984251848807-ld23n7s51al5v6ilhbff76lbj8vqi689.apps.googleusercontent.com";

async function verifyGoogleAccessToken(accessToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
  const tokenInfoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );
  if (!tokenInfoRes.ok) {
    throw new Error("Invalid or expired Google access token.");
  }
  const tokenInfo = await tokenInfoRes.json();
  if (tokenInfo.aud !== clientId && tokenInfo.azp !== clientId) {
    throw new Error("This Google token wasn't issued for this app.");
  }

  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userInfoRes.ok) {
    throw new Error("Invalid or expired Google access token.");
  }
  const payload = await userInfoRes.json();
  if (!payload.email) {
    throw new Error("Google account has no email address.");
  }
  if (payload.email_verified === false || payload.email_verified === "false") {
    throw new Error("Google account email is not verified.");
  }
  return {
    email: payload.email,
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture || null,
  };
}

module.exports = { verifyGoogleAccessToken };
