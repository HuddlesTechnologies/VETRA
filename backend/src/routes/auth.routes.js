/* =========================================================
   /api/auth: replaces the mock checks in signin.js/signup.js/
   admin/login.html's inline script (see BACKEND_GUIDE.md §4).
   Buyer and vendor share a signup/signin pair since they're the
   same flow with a different `role`; admin signin is separate
   since admins are never self-service signups.
   ========================================================= */

const crypto = require("crypto");
const express = require("express");
const pool = require("../db");
const { newId } = require("../utils/id");
const { hashPassword, verifyPassword } = require("../utils/password");
const { signToken, signTwoFactorChallenge, verifyTwoFactorChallenge } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");
const { notify } = require("../utils/notify");
const { sendEmail } = require("../utils/mailer");
const { escapeHtml } = require("../utils/escapeHtml");
const { verifyGoogleAccessToken } = require("../utils/googleAuth");
const { NIGERIAN_STATES } = require("../utils/nigerianStates");
const { optionalHttpsUrl } = require("../utils/safeUrl");
const { saveRemoteImage } = require("../utils/storage");
const { createAndEmailPasswordReset } = require("../utils/passwordReset");
const { sendAccountDeletedEmail } = require("../utils/accountEmail");
const { recordDevice, deviceIdFrom } = require("../utils/devices");
const { recordIdentifier, findBannedIdentifier } = require("../utils/identifiers");
const { BLOCKED_MESSAGE } = require("../utils/bans");

const RIDER_VEHICLES = ["bicycle", "motorbike", "car", "van"];
const BANNED_ACCOUNT_MESSAGE = "This account has been permanently banned. If you think this is a mistake, contact support@vetrahq.org.";
const {
  signinLimiter,
  adminSigninLimiter,
  googleAuthLimiter,
  signupLimiter,
  resetPasswordLimiter,
  forgotPasswordLimiter,
  twoFactorVerifyLimiter,
  twoFactorResendLimiter,
} = require("../middleware/rateLimit");

// Emails are stored and matched in lowercase, so "Ada@x.com" at signup
// and "ada@x.com" at sign-in (or the reverse) are the same account.
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "").slice(0, 45);
}

async function recordLoginIp(userId, req) {
  await recordDevice(userId, req);
  const ip = clientIp(req);
  if (!ip) return;
  try {
    await pool.query(`UPDATE users SET last_login_ip = ? WHERE id = ?`, [ip, userId]);
    await pool.query(
      `INSERT INTO login_ip_history (id, user_id, ip_address) VALUES (?, ?, ?)`,
      [newId(), userId, ip]
    );
  } catch (error) {
    // Login must remain available if an older deployment is briefly ahead
    // of its database migration. The next migration run restores auditing.
    console.error("Could not record login IP:", error.message);
  }
}

// Shared by both vendor signup paths (password + Google), a welcome
// email confirming the account is set up, with the same "KYC is what
// unlocks visibility" framing as the in-app notification right below
// each call site, only included when it's actually true (both
// vendor_approval_required and vendor_verification_required on, see
// PATCH /api/admin/vendors/:id/status's own check for why that
// combination specifically is what gates approval on a verified KYC
// submission). When it isn't gated, KYC still gets encouraged, just
// for the real benefit that applies then (the buyer-facing Verified
// badge) rather than a false "you're invisible until you do this."
async function sendVendorWelcomeEmail({ name, email, storeName, kycGatesVisibility }) {
  // storeName is null right after a brand-new Google signup, Google
  // only ever supplies name/email/photo, so the store name itself is
  // still one step away (the "complete your profile" prompt) at the
  // point this email goes out.
  const accountLine = storeName
    ? `Your VETRA vendor account for <strong>${escapeHtml(storeName)}</strong> has been created.`
    : `Your VETRA vendor account has been created.`;
  const kycLine = kycGatesVisibility
    ? `<p><strong>Your store won't be visible to buyers until your business verification (KYC) is approved.</strong> Submit your ID and CAC documents from your profile as soon as you can to get listed.</p>`
    : `<p>We encourage you to complete your business verification (KYC) from your profile, approved vendors get a Verified badge buyers can see on your storefront.</p>`;
  await sendEmail({
    to: email,
    subject: "Welcome to VETRA, your vendor account is set up",
    html: `<p>Hi ${escapeHtml(name)},</p><p>${accountLine}</p>${kycLine}`,
    logFallback: `vendor welcome email for ${email} (store: ${storeName || "n/a"}, kycGatesVisibility: ${kycGatesVisibility})`,
  });
}

const router = express.Router();

router.post(
  "/signup",
  signupLimiter,
  asyncHandler(async (req, res) => {
    const { role, name, firstName, middleName, lastName, password, phone, address, state, storeName, storeCategory, confirmOtherRole } = req.body;
    const { vehicle, plate } = req.body;
    const email = normalizeEmail(req.body.email);

    // Riders sign up from rider/signup.html, then verify their ID in the
    // rider app (POST /api/delivery/rider/identity) before taking jobs.
    if (!["buyer", "vendor", "rider"].includes(role)) {
      return res.status(400).json({ error: "role must be 'buyer', 'vendor' or 'rider'." });
    }
    // "Maintenance mode" (admin/settings.html) blocks new signups and
    // checkout, the two actions that create new state, while leaving
    // signin/browsing up, since this isn't meant to be a full outage.
    const [maintenanceRows] = await pool.query(`SELECT maintenance_mode FROM platform_settings WHERE id = 1`);
    if (maintenanceRows[0]?.maintenance_mode) {
      return res.status(503).json({ error: "VETRA is undergoing maintenance right now, please try signing up again shortly." });
    }
    // A rider's address is never used (jobs come by state), so it isn't asked for.
    if (!name || !email || !password || !phone || (role !== "rider" && !address)) {
      return res.status(400).json({ error: role === "rider" ? "name, email, password and phone are required." : "name, email, password, phone, and address are required." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "Your password must be at least 8 characters." });
    }
    // Required for every buyer/vendor signup, not just an optional
    // profile field, see signup.html's required State dropdown.
    if (!state || !NIGERIAN_STATES.includes(state)) {
      return res.status(400).json({ error: "A valid state is required." });
    }
    if (role === "vendor" && (!storeName || !storeCategory)) {
      return res.status(400).json({ error: "storeName and storeCategory are required for a vendor signup." });
    }
    if (["vendor", "rider"].includes(role) && (!firstName || !lastName)) {
      return res.status(400).json({ error: `firstName and lastName are required for a ${role} signup.` });
    }
    if (role === "rider" && !RIDER_VEHICLES.includes(vehicle)) {
      return res.status(400).json({ error: `vehicle must be one of: ${RIDER_VEHICLES.join(", ")}.` });
    }

    // A banned person can't open a new account with the same email,
    // phone or device (utils/bans.js).
    if (await findBannedIdentifier([["email", email], ["phone", phone], ["device", deviceIdFrom(req)]])) {
      return res.status(403).json({ error: BLOCKED_MESSAGE });
    }

    // Deleted accounts are retained for order/report history, so they cannot
    // be removed from users. Free the email from a legacy deleted row before
    // creating a new account; active, suspended, and pending accounts still
    // correctly block another signup with the same email and role.
    const [existingRows] = await pool.query(
      `SELECT id, status FROM users WHERE LOWER(email) = ? AND role = ? LIMIT 1`,
      [email, role]
    );
    const existingAccount = existingRows[0];
    if (existingAccount?.status === "deleted") {
      await pool.query(
        `UPDATE users SET email = ? WHERE id = ? AND status = 'deleted'`,
        [`deleted-${existingAccount.id}@vetra.deleted`, existingAccount.id]
      );
    } else if (existingAccount) {
      const roleLabel = role;
      return res.status(409).json({
        error: `This email is already registered for a ${roleLabel} account. Please sign in instead or use a different email.`,
      });
    }

    const [otherRoleRows] = await pool.query(
      `SELECT role, status FROM users
       WHERE LOWER(email) = ? AND role <> ? AND status <> 'deleted'
       LIMIT 1`,
      [email, role]
    );
    if (otherRoleRows[0] && !confirmOtherRole) {
      return res.status(409).json({
        error: "This email is already registered under another account role.",
        existingRole: otherRoleRows[0].role,
      });
    }

    const id = newId();
    const passwordHash = await hashPassword(password);
    // Vendors start "pending" until an admin approves the application,
    // matches admin/vendors.html's existing Pending Approval workflow,
    // unless admin/settings.html's "Require approval for new vendors"
    // toggle is off, in which case a new store goes live immediately.
    let status = "active";
    let vendorVerificationRequired = false;
    // A rider takes no jobs until their ID is verified (or an admin approves them).
    if (role === "rider") status = "pending";
    if (role === "vendor") {
      const [settingsRows] = await pool.query(
        `SELECT vendor_approval_required, vendor_verification_required FROM platform_settings WHERE id = 1`
      );
      status = settingsRows[0]?.vendor_approval_required === 0 ? "active" : "pending";
      vendorVerificationRequired = !!settingsRows[0]?.vendor_verification_required;
    }

    await pool.query(
      `INSERT INTO users (id, role, name, first_name, middle_name, last_name, email, phone, address, state, password_hash, status, store_name, store_category, rider_vehicle, rider_plate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, role, name, firstName || null, middleName || null, lastName || null, email, phone || null, address || null, state, passwordHash, status,
        storeName || null, storeCategory || null,
        role === "rider" ? vehicle : null,
        role === "rider" && plate ? String(plate).trim().toUpperCase().slice(0, 40) : null]
    );

    await recordIdentifier(id, "email", email);
    await recordIdentifier(id, "phone", phone);

    if (role === "vendor") {
      await logActivity({
        type: "vendor",
        message: `New vendor application from <strong>${escapeHtml(storeName)}</strong>.`,
        targetType: "vendor",
        targetId: id,
      });
      // Only actually true when both toggles are on, approval (and so
      // going live/visible) is gated on a verified KYC submission in
      // that case (see PATCH /api/admin/vendors/:id/status's own check).
      // If verification isn't required, or if approval was skipped
      // entirely (this vendor is already "active"), telling them KYC
      // is what unlocks visibility would just be wrong.
      const kycGatesVisibility = status === "pending" && vendorVerificationRequired;
      if (kycGatesVisibility) {
        await notify({
          userId: id,
          type: "kyc",
          title: "Complete your business verification",
          message: "Your store won't be visible to buyers until your business verification (KYC) is approved, submit your ID and CAC documents from your profile to get listed.",
          link: "profile.html",
        });
      }
      await sendVendorWelcomeEmail({ name, email, storeName, kycGatesVisibility });
    }
    if (role === "rider") {
      await logActivity({
        type: "delivery",
        message: `New rider signup: <strong>${escapeHtml(name)}</strong> (${escapeHtml(state)}), awaiting ID verification.`,
        targetType: "rider",
        targetId: id,
      });
    }

    await pool.query(`UPDATE users SET last_login_at = NOW(), last_activity_at = NOW(), session_version = session_version + 1 WHERE id = ?`, [id]);
    await recordLoginIp(id, req);
    const [[sessionRow]] = await pool.query(`SELECT session_version FROM users WHERE id = ?`, [id]);
    const token = signToken({ id, role, session_version: sessionRow.session_version });
    res.status(201).json({ token, user: { id, role, name, email, status } });
  })
);

// One combined signup-or-signin for "Continue with Google", signin.js/
// signup.js both call this with the same access-token flow (see
// google-signin.js). Finds an existing account by (email, role), same
// identity key the email/password flow uses, or creates one on the
// spot. A brand-new (or still-incomplete) account comes back with
// needsProfileCompletion: true so the frontend can prompt for phone/
// address (and storeName for a vendor) right away, since Google only
// ever supplies name/email/photo, never a delivery address, which is
// the whole reason this flow can't just silently finish signup on its
// own.
router.post(
  "/google",
  googleAuthLimiter,
  asyncHandler(async (req, res) => {
    const { accessToken, role } = req.body;
    if (!accessToken || !["buyer", "vendor"].includes(role)) {
      return res.status(400).json({ error: "accessToken and a role of 'buyer' or 'vendor' are required." });
    }

    let profile;
    try {
      profile = await verifyGoogleAccessToken(accessToken);
      profile.email = normalizeEmail(profile.email);
    } catch (err) {
      console.error("Google sign-in verification failed:", err.message);
      return res.status(401).json({ error: "Couldn't verify Google sign-in. Please try again." });
    }

    const [existing] = await pool.query(
      `SELECT * FROM users WHERE LOWER(email) = ? AND role = ? LIMIT 1`,
      [profile.email, role]
    );
    let user = existing[0];

    // A deleted account keeps its row for order history but must not be
    // signed back into. Free its email, same as /signup, so this Google
    // sign-in creates a fresh account instead of failing.
    if (user?.status === "deleted") {
      await pool.query(
        `UPDATE users SET email = ? WHERE id = ? AND status = 'deleted'`,
        [`deleted-${user.id}@vetra.deleted`, user.id]
      );
      user = undefined;
    }

    if (user?.status === "banned") {
      return res.status(403).json({ error: BANNED_ACCOUNT_MESSAGE });
    }

    if (!user) {
      if (await findBannedIdentifier([["email", profile.email], ["device", deviceIdFrom(req)]])) {
        return res.status(403).json({ error: BLOCKED_MESSAGE });
      }
      // A brand-new account is a signup, so maintenance mode blocks it
      // here exactly as it blocks POST /signup. Existing accounts can
      // still sign in with Google, same as password sign-in.
      const [maintenanceRows] = await pool.query(`SELECT maintenance_mode FROM platform_settings WHERE id = 1`);
      if (maintenanceRows[0]?.maintenance_mode) {
        return res.status(503).json({ error: "VETRA is undergoing maintenance right now, please try signing up again shortly." });
      }
      const id = newId();
      // No password of their own, a random, never-shared hash satisfies
      // password_hash's NOT NULL constraint without making the column
      // nullable just for this one signup path.
      const passwordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
      // Same "Require approval for new vendors" toggle as /signup.
      let status = "active";
      let vendorVerificationRequired = false;
      if (role === "vendor") {
        const [settingsRows] = await pool.query(
          `SELECT vendor_approval_required, vendor_verification_required FROM platform_settings WHERE id = 1`
        );
        status = settingsRows[0]?.vendor_approval_required === 0 ? "active" : "pending";
        vendorVerificationRequired = !!settingsRows[0]?.vendor_verification_required;
      }

      // A copy of the Google photo, stored here: no avatar links off this server.
      const avatarUrl = profile.picture
        ? await saveRemoteImage(profile.picture.replace(/=s\d+(-c)?$/, "=s400-c"), { folder: "avatars" })
        : null;
      await pool.query(
        `INSERT INTO users (id, role, name, email, password_hash, status, signup_method, avatar_url)
         VALUES (?, ?, ?, ?, ?, ?, 'google', ?)`,
        [id, role, profile.name, profile.email, passwordHash, status, avatarUrl]
      );
      await recordIdentifier(id, "email", profile.email);

      if (role === "vendor") {
        await logActivity({
          type: "vendor",
          message: `New vendor application from <strong>${escapeHtml(profile.name)}</strong> (Google sign-up).`,
          targetType: "vendor",
          targetId: id,
        });
        // Same "KYC is what unlocks visibility" nudge as /signup, see
        // that route's own comment on why both toggles matter here.
        const kycGatesVisibility = status === "pending" && vendorVerificationRequired;
        if (kycGatesVisibility) {
          await notify({
            userId: id,
            type: "kyc",
            title: "Complete your business verification",
            message: "Your store won't be visible to buyers until your business verification (KYC) is approved, submit your ID and CAC documents from your profile to get listed.",
            link: "profile.html",
          });
        }
        await sendVendorWelcomeEmail({ name: profile.name, email: profile.email, storeName: null, kycGatesVisibility });
      }

      const [rows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [id]);
      user = rows[0];
    } else {
      if (user.status === "suspended") {
        return res.status(403).json({ error: "This account has been suspended. Contact support." });
      }
      await pool.query(`UPDATE users SET last_login_at = NOW(), last_activity_at = NOW(), session_version = session_version + 1 WHERE id = ?`, [user.id]);
    }

    await logActivity({
      type: "login",
      message: `${role === "vendor" ? "Vendor" : "Customer"} <strong>${escapeHtml(user.name)}</strong> signed in with Google.`,
      targetType: role,
      targetId: user.id,
    });

    // state is required for every account, same as phone/address, see
    // the note on signup.html's required State dropdown.
    const needsProfileCompletion = role === "vendor"
      ? !user.store_name || !user.store_category || !user.phone || !user.address || !user.state
      : !user.phone || !user.address || !user.state;

    await pool.query(`UPDATE users SET last_activity_at = NOW(), session_version = session_version + 1 WHERE id = ?`, [user.id]);
    await recordLoginIp(user.id, req);

    const [[sessionRow]] = await pool.query(`SELECT session_version FROM users WHERE id = ?`, [user.id]);
    const token = signToken({ ...user, session_version: sessionRow.session_version });
    res.json({
      token,
      user: { id: user.id, role: user.role, name: user.name, email: user.email, status: user.status, avatarUrl: user.avatar_url },
      needsProfileCompletion,
    });
  })
);

// ---------- Two-factor authentication (email one-time code) ----------
// Shared by /signin and /admin-signin below, and by /2fa/verify/resend
// further down, see migrations/004_two_factor_auth.sql for the schema.

function hashCode(rawCode) {
  return crypto.createHash("sha256").update(rawCode).digest("hex");
}

// Any earlier unconsumed code for this user is superseded (not reused,
// a stale code from a page the user abandoned shouldn't still work),
// so at most one code is ever valid at a time.
async function createAndEmailTwoFactorCode(user) {
  await pool.query(
    `UPDATE two_factor_codes SET consumed_at = NOW() WHERE user_id = ? AND consumed_at IS NULL`,
    [user.id]
  );

  const rawCode = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await pool.query(
    `INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, ?)`,
    [newId(), user.id, hashCode(rawCode), expiresAt]
  );

  await sendEmail({
    to: user.email,
    subject: `${rawCode} is your VETRA sign-in code`,
    html: `<p>Hi ${escapeHtml(user.name)},</p><p>Your VETRA sign-in code is:</p><p style="font-size:28px; font-weight:700; letter-spacing:4px;">${rawCode}</p><p>This code expires in 10 minutes. If you didn't try to sign in, you can ignore this email.</p>`,
    logFallback: `2FA code for ${user.email}: ${rawCode}`,
  });
}

// Completes a buyer/vendor sign-in, called directly when 2FA is off,
// or from /2fa/verify once a code checks out. Not wrapped in res.json
// itself so both call sites can shape the response the same way.
async function finalizeUserSignin(user, req) {
  await pool.query(`UPDATE users SET last_login_at = NOW(), last_activity_at = NOW(), session_version = session_version + 1 WHERE id = ?`, [user.id]);
  await recordLoginIp(user.id, req);
  await logActivity({
    type: "login",
    message: `${{ vendor: "Vendor", rider: "Rider" }[user.role] || "Customer"} <strong>${escapeHtml(user.name)}</strong> signed in.`,
    targetType: user.role,
    targetId: user.id,
  });

  const [[sessionRow]] = await pool.query(`SELECT session_version FROM users WHERE id = ?`, [user.id]);
  const token = signToken({ ...user, session_version: sessionRow.session_version });
  return {
    token,
    // avatarUrl travels with the session so the header avatar (see
    // customer/assets/interactions.js, vendor/assets/interactions.js)
    // reflects a previously-uploaded photo from the very first page
    // load, not only after visiting settings/profile once GET /auth/me
    // has run there.
    user: { id: user.id, role: user.role, name: user.name, email: user.email, status: user.status, avatarUrl: user.avatar_url },
  };
}

// Admin equivalent of finalizeUserSignin above.
async function finalizeAdminSignin(admin, req) {
  await pool.query(`UPDATE users SET last_login_at = NOW(), last_activity_at = NOW(), session_version = session_version + 1 WHERE id = ?`, [admin.id]);
  await recordLoginIp(admin.id, req);
  await logActivity({
    type: "login",
    message: `Admin <strong>${escapeHtml(admin.email)}</strong> signed in to the admin console.`,
    actorUserId: admin.id,
  });

  const [[sessionRow]] = await pool.query(`SELECT session_version FROM users WHERE id = ?`, [admin.id]);
  const token = signToken({ ...admin, session_version: sessionRow.session_version });
  return {
    token,
    user: { id: admin.id, name: admin.name, email: admin.email, adminRole: admin.admin_role, avatarUrl: admin.avatar_url },
  };
}

router.post(
  "/signin",
  signinLimiter,
  asyncHandler(async (req, res) => {
    const { role, password } = req.body;
    const email = normalizeEmail(req.body.email);
    // Riders sign in here too (rider/login.html). They either signed up
    // themselves (rider/signup.html) or were added from admin/deliveries.html.
    if (!["buyer", "vendor", "rider"].includes(role)) {
      return res.status(400).json({ error: "role must be 'buyer', 'vendor' or 'rider'." });
    }

    const [rows] = await pool.query(
      `SELECT * FROM users WHERE LOWER(email) = ? AND role = ? LIMIT 1`,
      [email, role]
    );
    const user = rows[0];
    if (!user || !(await verifyPassword(password || "", user.password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    if (user.status === "banned") {
      return res.status(403).json({ error: BANNED_ACCOUNT_MESSAGE });
    }
    if (user.status === "suspended") {
      return res.status(403).json({ error: "This account has been suspended. Contact support." });
    }

    // Password alone isn't a completed sign-in when 2FA is on, no
    // token yet, no last_login_at/activity-log entry either (see
    // finalizeUserSignin, only reached from here or /2fa/verify).
    if (user.two_factor_enabled) {
      await createAndEmailTwoFactorCode(user);
      return res.json({ twoFactorRequired: true, challengeToken: signTwoFactorChallenge(user) });
    }

    res.json(await finalizeUserSignin(user, req));
  })
);

router.post(
  "/admin-signin",
  adminSigninLimiter,
  asyncHandler(async (req, res) => {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);
    const [rows] = await pool.query(
      `SELECT * FROM users WHERE LOWER(email) = ? AND role = 'admin' LIMIT 1`,
      [email]
    );
    const admin = rows[0];
    if (!admin || !(await verifyPassword(password || "", admin.password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    if (admin.status === "suspended") {
      return res.status(403).json({ error: "This account has been suspended. Contact support." });
    }

    if (admin.two_factor_enabled) {
      await createAndEmailTwoFactorCode(admin);
      return res.json({ twoFactorRequired: true, challengeToken: signTwoFactorChallenge(admin) });
    }

    res.json(await finalizeAdminSignin(admin, req));
  })
);

// Resolves the challenge token a signin route issued after a correct
// password into that pending user's row. Null if the token is missing,
// expired, forged, or already used (session_version moved on).
async function pendingTwoFactorUser(challengeToken) {
  let payload;
  try {
    payload = verifyTwoFactorChallenge(challengeToken);
  } catch {
    return null;
  }
  const [rows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [payload.id]);
  const user = rows[0];
  if (!user || !user.two_factor_enabled) return null;
  if (Number(user.session_version || 0) !== Number(payload.sessionVersion || 0)) return null;
  return user;
}

// Redeems the code either signin route above sent. The challenge token
// proves the password step already succeeded; the role is read off the
// user's own row, never trusted from the client.
router.post(
  "/2fa/verify",
  twoFactorVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { challengeToken, code } = req.body;
    if (!challengeToken || !code) {
      return res.status(400).json({ error: "challengeToken and code are required." });
    }

    const user = await pendingTwoFactorUser(challengeToken);
    if (!user) {
      return res.status(401).json({ error: "This sign-in has expired. Enter your password again." });
    }
    const userId = user.id;
    if (user.status === "suspended") {
      return res.status(403).json({ error: "This account has been suspended. Contact support." });
    }

    const [codeRows] = await pool.query(
      `SELECT * FROM two_factor_codes WHERE user_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    const pending = codeRows[0];
    if (!pending || new Date(pending.expires_at) < new Date()) {
      return res.status(401).json({ error: "That code has expired. Request a new one." });
    }
    if (pending.attempts >= 5) {
      return res.status(401).json({ error: "Too many incorrect attempts. Request a new code." });
    }

    if (hashCode(String(code)) !== pending.code_hash) {
      await pool.query(`UPDATE two_factor_codes SET attempts = attempts + 1 WHERE id = ?`, [pending.id]);
      return res.status(401).json({ error: "Incorrect code." });
    }

    await pool.query(`UPDATE two_factor_codes SET consumed_at = NOW() WHERE id = ?`, [pending.id]);

    res.json(user.role === "admin" ? await finalizeAdminSignin(user, req) : await finalizeUserSignin(user, req));
  })
);

router.post(
  "/2fa/resend",
  twoFactorResendLimiter,
  asyncHandler(async (req, res) => {
    const user = await pendingTwoFactorUser(req.body.challengeToken);
    if (!user) {
      return res.status(401).json({ error: "This sign-in has expired. Enter your password again." });
    }

    await createAndEmailTwoFactorCode(user);
    res.json({ ok: true });
  })
);

// Requires the current password even though customer/settings.html's
// Security form no longer collects one (see BACKEND_GUIDE.md §4 point 5,
// that was a UI call, not license to skip verification server-side; a
// leaked/stolen token would otherwise be enough to lock the real owner out).
router.patch(
  "/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters." });
    }

    const [rows] = await pool.query(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    const user = rows[0];
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const newHash = await hashPassword(newPassword);
    await pool.query(`UPDATE users SET password_hash = ?, password_changed_at = NOW(), session_version = session_version + 1 WHERE id = ?`, [newHash, req.user.id]);
    await logActivity({
      type: "account",
      message: "Changed account password.",
      actorUserId: req.user.id,
      targetType: req.user.role,
      targetId: req.user.id,
    });
    res.json({ ok: true });
  })
);

// Self-service "Deactivate account"/"Deactivate store" (customer/
// settings.html, vendor/profile.html's Danger Zone), same end state
// as an admin suspending the account (status='suspended'), just a
// different actor and reason. Reversible by contacting support, same
// as an admin-initiated suspension already is (see admin.routes.js's
// PATCH /customers|vendors/:id/status).
router.patch(
  "/deactivate",
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query(`UPDATE users SET status = 'suspended', session_version = session_version + 1 WHERE id = ?`, [req.user.id]);
    await logActivity({
      type: "account",
      message: "Deactivated own account.",
      actorUserId: req.user.id,
      targetType: req.user.role === "vendor" ? "vendor" : "customer",
      targetId: req.user.id,
    });
    res.json({ ok: true });
  })
);

// Self-service "Delete account" (vendor/profile.html's Danger Zone
// only, no admin equivalent, and no customer-facing button today).
// Unlike deactivate, this is meant to be terminal: real deletion isn't
// possible without breaking every order/report/review row that
// legitimately still needs to exist for the *other* party (a buyer's
// own order history shouldn't vanish because the vendor they bought
// from deleted their account), so this scrubs personally-identifying
// fields and marks the row 'deleted' instead of removing it, the
// standard shape for this on any real marketplace. A vendor's
// listings are delisted (status='removed') in the same transaction so
// they stop appearing in the public catalog immediately.
router.post(
  "/delete-account",
  requireAuth,
  asyncHandler(async (req, res) => {
    // Captured before the row is scrubbed, for the confirmation email.
    const [[before]] = await pool.query(`SELECT name, email FROM users WHERE id = ?`, [req.user.id]);
    const placeholderEmail = `deleted-${req.user.id}@vetra.deleted`;
    const randomPasswordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE users SET
           status = 'deleted', name = 'Deleted User', email = ?, password_hash = ?, session_version = session_version + 1,
           phone = NULL, address = NULL, avatar_url = NULL,
           store_name = ?, store_description = NULL, store_cover_url = NULL,
           payout_bank_name = NULL, payout_account_number_enc = NULL, payout_account_name = NULL
         WHERE id = ?`,
        [placeholderEmail, randomPasswordHash, req.user.role === "vendor" ? "Deleted Store" : null, req.user.id]
      );
      if (req.user.role === "vendor") {
        await connection.query(`UPDATE products SET status = 'removed' WHERE vendor_id = ?`, [req.user.id]);
      }
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    await logActivity({
      type: "account",
      message: "Deleted own account.",
      actorUserId: null, // the account no longer identifies as itself after this
      targetType: req.user.role === "vendor" ? "vendor" : "customer",
      targetId: req.user.id,
    });
    await sendAccountDeletedEmail({ email: before?.email, name: before?.name, byAdmin: false });
    res.json({ ok: true });
  })
);

// Companion read for PATCH /me below, POST /signup and /signin only
// return {id, role, name, email, status} (what's needed at that
// moment), not the full profile, so a page that wants to actually
// display/edit phone, address, or a vendor's store fields needs a
// real fetch, not just what login happened to return.
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, role, name, email, phone, address, state, avatar_url, store_name, store_category, store_description, store_cover_url, admin_role, kyc_email_alerts_enabled, two_factor_enabled, created_at, password_changed_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Account not found." });
    res.json(rows[0]);
  })
);

// Generic "update my own profile", the real endpoint behind every
// per-field pencil-edit save on vendor/profile.html's Store Details,
// customer/settings.html's Profile card, and admin/settings.html's
// Account Details card (all three call this same route today, one
// field at a time, per their own `// TODO: replace with a real
// per-field save API call` comment). Also where a freshly-uploaded
// avatar/cover URL (POST /api/uploads) actually gets attached to the
// account, since that route only returns a URL and doesn't persist it.
router.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.body.state !== undefined && !NIGERIAN_STATES.includes(req.body.state)) {
      return res.status(400).json({ error: "state must be a valid Nigerian state." });
    }

    const fieldMap = { name: "name", email: "email", phone: "phone", address: "address", state: "state", avatarUrl: "avatar_url" };
    // A rider's state is their dispatch zone, which auto-assign matches
    // parcels against. They change it through PATCH /api/delivery/rider/zone,
    // which refuses while they hold a job.
    if (req.user.role === "rider") delete fieldMap.state;
    if (req.user.role === "vendor") {
      Object.assign(fieldMap, {
        storeName: "store_name",
        storeCategory: "store_category",
        storeDescription: "store_description",
        storeCoverUrl: "store_cover_url",
      });
    }
    // Per-admin opt-out of the "vendor submitted KYC" email, see
    // vendors.routes.js's POST /me/kyc. Not exposed to buyer/vendor
    // accounts; there's nothing for that toggle to mean there.
    if (req.user.role === "admin") {
      fieldMap.kycEmailAlertsEnabled = "kyc_email_alerts_enabled";
    }
    // 2FA toggle, only surfaced on admin/settings.html and
    // vendor/profile.html (see migrations/004_two_factor_auth.sql);
    // buyer accounts have no such control.
    if (req.user.role === "admin" || req.user.role === "vendor") {
      fieldMap.twoFactorEnabled = "two_factor_enabled";
    }

    if (req.body.email !== undefined) req.body.email = normalizeEmail(req.body.email);
    if ((req.body.email !== undefined || req.body.phone !== undefined)
      && await findBannedIdentifier([["email", req.body.email], ["phone", req.body.phone]])) {
      return res.status(403).json({ error: BLOCKED_MESSAGE });
    }

    // Rendered into <img src> across every app, see utils/safeUrl.js.
    for (const key of ["avatarUrl", "storeCoverUrl"]) {
      if (req.body[key] !== undefined) req.body[key] = optionalHttpsUrl(req.body[key]);
    }

    const updates = [];
    const params = [];
    for (const [bodyKey, column] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        updates.push(`${column} = ?`);
        params.push(req.body[bodyKey]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: "No fields to update." });

    params.push(req.user.id);
    await pool.query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);
    if (req.body.email) await recordIdentifier(req.user.id, "email", req.body.email);
    if (req.body.phone) await recordIdentifier(req.user.id, "phone", req.body.phone);

    const [rows] = await pool.query(
      `SELECT id, role, name, email, phone, address, state, avatar_url, store_name, store_category, store_description, store_cover_url, admin_role, kyc_email_alerts_enabled, two_factor_enabled, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    res.json(rows[0]);
  })
);

// Self-service "Forgot password?" from signin.html (buyers and vendors)
// and rider/login.html (riders). Admins go through another admin. Always answers the
// same way, and does the lookup and email after responding, so neither
// the message nor the response time reveals whether an account exists.
const FORGOT_PASSWORD_ROLES = ["buyer", "vendor", "rider"];
const MAX_RESETS_PER_HOUR = 3;

async function sendSelfServiceReset(role, email) {
  const [rows] = await pool.query(
    `SELECT id, name, email, status FROM users WHERE LOWER(email) = ? AND role = ? LIMIT 1`,
    [email, role]
  );
  const user = rows[0];
  // Suspended/deleted/rejected accounts can't sign in anyway; a reset
  // link mustn't become a way around that.
  if (!user || !["active", "pending"].includes(user.status)) return;

  const [[{ recent }]] = await pool.query(
    `SELECT COUNT(*) AS recent FROM password_reset_tokens WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 HOUR`,
    [user.id]
  );
  if (recent >= MAX_RESETS_PER_HOUR) return;

  // Only the newest link works, so an older email lying around in an
  // inbox can't be used once a fresh one has been requested.
  await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL`, [user.id]);
  await createAndEmailPasswordReset(user, {
    linkFor: role === "rider" ? "rider" : undefined,
    introHtml: "We received a request to reset the password for your VETRA account. Click below to choose a new one.",
  });
  await logActivity({
    type: "account",
    message: "Password reset link requested from the sign-in page.",
    targetType: { vendor: "vendor", rider: "rider" }[role] || "customer",
    targetId: user.id,
  });
}

router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  asyncHandler(async (req, res) => {
    const role = req.body.role;
    const email = normalizeEmail(req.body.email);
    if (!FORGOT_PASSWORD_ROLES.includes(role)) {
      return res.status(400).json({ error: "role must be 'buyer', 'vendor' or 'rider'." });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    res.json({ ok: true, message: "If an account matches that email, we've sent a link to reset your password." });
    sendSelfServiceReset(role, email).catch((error) => console.error("Forgot-password email failed:", error.message));
  })
);

// Redeems the link admin.routes.js's POST /admin/customers|vendors/:id/
// reset-password and POST /forgot-password above email out (see
// password_reset_tokens in migrations/001_init.sql), public, since whoever clicks the email
// link isn't signed in yet. hashToken() must match exactly how that
// route hashes the raw token before storing it.
function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

router.post(
  "/reset-password",
  resetPasswordLimiter,
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: "token and newPassword are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters." });
    }

    const [rows] = await pool.query(
      `SELECT prt.*, u.role FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = ? AND prt.used_at IS NULL AND prt.expires_at > NOW()`,
      [hashToken(token)]
    );
    const resetToken = rows[0];
    if (!resetToken) {
      return res.status(400).json({ error: "This reset link is invalid or has expired." });
    }

    const newHash = await hashPassword(newPassword);
    await pool.query(`UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?`, [newHash, resetToken.user_id]);
    await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?`, [resetToken.id]);
    await logActivity({
      type: "account",
      message: "Password reset via emailed link.",
      targetType: { vendor: "vendor", rider: "rider" }[resetToken.role] || "customer",
      targetId: resetToken.user_id,
    });

    res.json({ ok: true });
  })
);

module.exports = router;
