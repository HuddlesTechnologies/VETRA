/* IDCheck.ng identity verification for vendor KYC (vendors.routes.js,
   POST /me/kyc/verify). API reference: https://api.idcheck.ng/v1/openapi.json
   (the GitBook docs at docs.idcheck.ng describe an older API and are out
   of date).

   Each verify* function resolves to { verified, message }, where
   `verified` already includes the name check against the vendor's legal
   name, so the route only has to combine the results. Provider payloads
   are never returned or stored; they can hold sensitive identity data.

   Throws with statusCode 503 only when IDCHECK_API_KEY is unset, which
   the route surfaces as "not configured". Every provider-side failure
   (record not found, wallet out of credit, upstream down, timeout) throws
   with 422 or 502 instead, and the route turns that into a failed check
   and manual review. */

const crypto = require("crypto");

const IDCHECK_BASE_URL = (process.env.IDCHECK_BASE_URL || "https://api.idcheck.ng").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 20000;

// NDPR-style purpose code IDCheck forwards to NIMC for NIN lookups
// (GET /v1/identity/nin/request-reasons). Onboarding a vendor to an online
// platform is "logical/virtual access".
const NIN_REQUEST_REASON = "logicalVirtualAccess";

const ERROR_MESSAGES = {
  401: "The IDCheck.ng API key was rejected.",
  402: "The IDCheck.ng wallet is out of credit.",
  404: "No record was found for this number.",
  429: "IDCheck.ng rate limit reached. Try again shortly.",
};

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function pick(record, keys) {
  for (const key of keys) {
    if (record[key]) return record[key];
  }
  return "";
}

// The record inside data.data is untyped in IDCheck's spec, so accept the
// usual spellings of each name field.
function recordName(record = {}) {
  return {
    firstName: pick(record, ["first_name", "firstName", "firstname"]),
    middleName: pick(record, ["middle_name", "middleName", "middlename"]),
    lastName: pick(record, ["last_name", "lastName", "lastname", "surname"]),
  };
}

function namesMatch(found, vendor) {
  return Boolean(found.firstName && found.lastName)
    && normalizeName(found.firstName) === normalizeName(vendor.firstName)
    && normalizeName(found.lastName) === normalizeName(vendor.lastName)
    && (!vendor.middleName || normalizeName(found.middleName) === normalizeName(vendor.middleName));
}

function withEnvironment(message, environment) {
  // Sandbox keys (sk_test_...) return synthetic data, so a sandbox pass
  // proves nothing about the real person. Say so wherever admins see it.
  return environment === "sandbox" ? `${message} (IDCheck.ng sandbox, not a real check)` : message;
}

async function request(path, body) {
  if (!process.env.IDCHECK_API_KEY) {
    const error = new Error("Identity verification is not configured yet.");
    error.statusCode = 503;
    throw error;
  }

  let response;
  try {
    response = await fetch(`${IDCHECK_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.IDCHECK_API_KEY}`,
        "Content-Type": "application/json",
        // Required on every mutating /v1 route. A fresh key per call: each
        // verification attempt is meant to run, not replay a cached result.
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const error = new Error(cause.name === "TimeoutError" ? "IDCheck.ng timed out." : "IDCheck.ng could not be reached.");
    error.statusCode = 502;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || !payload.success) {
    const error = new Error(
      ERROR_MESSAGES[response.status]
      || payload.error?.message
      || `IDCheck.ng returned HTTP ${response.status}.`
    );
    error.statusCode = response.status >= 500 ? 502 : 422;
    throw error;
  }

  return payload.data;
}

async function verifyNin(nin, vendor) {
  const data = await request("/v1/identity/nin/compare", {
    nin,
    first_name: vendor.firstName,
    last_name: vendor.lastName,
    ...(vendor.middleName ? { middle_name: vendor.middleName } : {}),
    request_reason: NIN_REQUEST_REASON,
    subject_reference: vendor.id,
  });
  const verified = data.verdict === "MATCH";
  return {
    verified,
    message: withEnvironment(
      verified ? "NIN verified and the name matches." : "The name on this NIN does not match the vendor's legal name.",
      data.environment
    ),
  };
}

// BVN match compares first and last name only; IDCheck takes no middle name here.
async function verifyBvn(bvn, vendor) {
  const data = await request("/v1/identity/bvn/match", {
    bvn,
    first_name: vendor.firstName,
    last_name: vendor.lastName,
    subject_reference: vendor.id,
  });
  const verified = data.verdict === "MATCH";
  return {
    verified,
    message: withEnvironment(
      verified ? "BVN verified and the name matches." : "The name on this BVN does not match the vendor's legal name.",
      data.environment
    ),
  };
}

// The licence lookup takes no name, so the name comes back in the record
// and is compared here.
async function verifyDriversLicence(licenceNumber, dateOfBirth, vendor) {
  const data = await request("/v1/identity/drivers-licence", {
    licence_number: licenceNumber,
    date_of_birth: dateOfBirth,
    subject_reference: vendor.id,
  });
  let message;
  let verified = false;
  if (data.verdict !== "MATCH") {
    message = "The licence number and date of birth do not match a licence record.";
  } else if (!namesMatch(recordName(data.data), vendor)) {
    message = "The name on the driver's licence does not match the vendor's legal name.";
  } else {
    verified = true;
    message = "Driver's licence verified and the name matches.";
  }
  return { verified, message: withEnvironment(message, data.environment) };
}

async function verifyCac(rcNumber, vendorId) {
  const data = await request("/v1/business/cac", { rc_number: rcNumber, subject_reference: vendorId });
  const verified = data.verdict === "MATCH";
  const companyName = pick(data.data || {}, ["company_name", "companyName", "name", "business_name"]);
  let message;
  if (!verified) message = "No CAC registration was found for this number.";
  else if (companyName) message = `CAC registration verified: ${companyName}.`;
  else message = "CAC registration verified.";
  return { verified, message: withEnvironment(message, data.environment) };
}

module.exports = { verifyNin, verifyBvn, verifyDriversLicence, verifyCac };
