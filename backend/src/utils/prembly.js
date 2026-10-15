/* Prembly identity verification, used by vendor KYC (vendors.routes.js,
   POST /me/kyc/verify) and rider signup (delivery.routes.js,
   POST /api/delivery/rider/identity). API reference: docs.prembly.com
   (index at https://docs.prembly.com/llms.txt). Every call is a POST to
   https://api.prembly.com/verification/... with the secret key in the
   x-api-key header.

   Each verify* function resolves to { verified, message }, where
   `verified` already includes the name check against the person's legal
   name, so the routes only have to combine the results. `person` is
   { id, firstName, middleName, lastName }. Provider payloads are never
   returned or stored; they can hold sensitive identity data and photos.

   Throws with statusCode 503 only when PREMBLY_API_KEY is unset, which
   the routes surface as "not configured". Every provider-side failure
   (record not found, wallet out of credit, upstream down, timeout) throws
   with 422 or 502 instead, which the routes turn into a failed check. */

const PREMBLY_BASE_URL = (process.env.PREMBLY_BASE_URL || "https://api.prembly.com").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 20000;

// Prembly's own codes, returned inside the JSON body (often with HTTP 200).
const RESPONSE_CODE_MESSAGES = {
  "01": "No record was found for this number. Check it and try again.",
  "02": "The ID service is unavailable right now. Try again later.",
  "03": "The Prembly wallet is out of credit.",
  "07": "This number is blocked and can't be verified.",
};
const HTTP_MESSAGES = {
  401: "The Prembly API key was rejected.",
  403: "The Prembly API key was rejected.",
  429: "Prembly rate limit reached. Try again shortly.",
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
    if (record?.[key]) return record[key];
  }
  return "";
}

// First and last name must match. A middle name is only compared when both
// sides have one: plenty of ID records leave it out.
function namesMatch(found, person) {
  const middleFound = normalizeName(found.middleName);
  const middleGiven = normalizeName(person.middleName);
  return Boolean(found.firstName && found.lastName)
    && normalizeName(found.firstName) === normalizeName(person.firstName)
    && normalizeName(found.lastName) === normalizeName(person.lastName)
    && (!middleFound || !middleGiven || middleFound === middleGiven);
}

// A record that only has a full name ("ADEBAYO JOHN OKAFOR"): first and
// last name each have to appear in it, in any order.
function fullNameContains(fullName, person) {
  const words = new Set(normalizeName(fullName).split(" ").filter(Boolean));
  const required = [person.firstName, person.lastName].flatMap((n) => normalizeName(n).split(" ").filter(Boolean));
  return required.length > 0 && required.every((w) => words.has(w));
}

async function request(path, body) {
  if (!process.env.PREMBLY_API_KEY) {
    const error = new Error("Identity verification is not configured yet.");
    error.statusCode = 503;
    throw error;
  }

  let response;
  try {
    response = await fetch(`${PREMBLY_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "x-api-key": process.env.PREMBLY_API_KEY,
        // Only older IdentityPass accounts need this; newer keys work alone.
        ...(process.env.PREMBLY_APP_ID ? { "app-id": process.env.PREMBLY_APP_ID } : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const error = new Error(cause.name === "TimeoutError" ? "Prembly timed out." : "Prembly could not be reached.");
    error.statusCode = 502;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  const code = String(payload.response_code || "");
  if (!response.ok || payload.status !== true || (code && code !== "00")) {
    const error = new Error(
      RESPONSE_CODE_MESSAGES[code]
      || HTTP_MESSAGES[response.status]
      || payload.detail
      || payload.message
      || `Prembly returned HTTP ${response.status}.`
    );
    error.statusCode = response.status >= 500 || code === "02" ? 502 : 422;
    throw error;
  }
  return payload;
}

function result(verified, okMessage, failMessage) {
  return { verified, message: verified ? okMessage : failMessage };
}

async function verifyNin(nin, person) {
  const payload = await request("/verification/vnin-basic", { number: nin });
  const record = payload.data || payload.nin_data || {};
  const found = {
    firstName: pick(record, ["firstname", "first_name", "firstName"]),
    middleName: pick(record, ["middlename", "middle_name", "middleName"]),
    lastName: pick(record, ["surname", "last_name", "lastName", "lastname"]),
  };
  return result(namesMatch(found, person), "NIN verified and the name matches.", "The name on this NIN does not match the name on the account.");
}

async function verifyBvn(bvn, person) {
  const payload = await request("/verification/bvn_validation", { number: bvn });
  const record = payload.data || {};
  const found = {
    firstName: pick(record, ["firstName", "first_name", "firstname"]),
    middleName: pick(record, ["middleName", "middle_name", "middlename"]),
    lastName: pick(record, ["lastName", "last_name", "lastname", "surname"]),
  };
  return result(namesMatch(found, person), "BVN verified and the name matches.", "The name on this BVN does not match the name on the account.");
}

// FRSC checks the number, date of birth and name together and only answers
// verified or not, so there's no record to compare here.
async function verifyDriversLicence(licenceNumber, dateOfBirth, person) {
  const payload = await request("/verification/drivers_license", {
    number: licenceNumber,
    dob: dateOfBirth,
    first_name: person.firstName,
    last_name: person.lastName,
  });
  const frsc = payload.frsc_data || payload.data || {};
  const verified = frsc.verified === true || payload.verification?.status === "VERIFIED";
  return result(
    verified,
    "Driver's licence verified and the name matches.",
    "The licence number, date of birth and name do not match an FRSC record."
  );
}

async function verifyVotersCard(vin, person) {
  const payload = await request("/verification/voters_card", { number: vin, last_name: person.lastName });
  const record = payload.data || payload.vc_data || {};
  const first = pick(record, ["first_name", "firstName"]);
  const last = pick(record, ["last_name", "lastName", "surname"]);
  const verified = first && last
    ? namesMatch({ firstName: first, lastName: last }, { ...person, middleName: null })
    : fullNameContains(pick(record, ["fullName", "full_name", "name"]), person);
  return result(verified, "Voter's card verified and the name matches.", "The name on this voter's card does not match the name on the account.");
}

// RC, BN and IT numbers: the prefix is sent as company_type, the digits as rc_number.
async function verifyCac(cacNumber) {
  const match = /^(RC|BN|IT|LP|LLP)?(\d+)$/.exec(cacNumber);
  const payload = await request("/verification/cac/basic", {
    rc_number: match ? match[2] : cacNumber,
    company_type: match?.[1] || "RC",
  });
  const companyName = pick(payload.data || {}, ["company_name", "companyName", "name", "business_name"]);
  return { verified: true, message: companyName ? `CAC registration verified: ${companyName}.` : "CAC registration verified." };
}

module.exports = { verifyNin, verifyBvn, verifyDriversLicence, verifyVotersCard, verifyCac };
