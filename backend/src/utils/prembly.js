/* Prembly identity verification, used by vendor KYC (vendors.routes.js,
   POST /me/kyc/verify) and rider signup (delivery.routes.js,
   POST /api/delivery/rider/identity). API reference: docs.prembly.com
   (index at https://docs.prembly.com/llms.txt). Every call is a POST to
   https://api.prembly.com/api/v1/verification/api/<channel>/ with the
   secret key in the x-api-key header.

   Each verify* function resolves to { verified, message }. `verified`
   already includes the name check, and `message` is plain English the
   user can act on ("The last name on your NIN doesn't match ..."), so
   routes can show it as is. `person` is { id, firstName, middleName,
   lastName }. Provider payloads are never returned or stored; they can
   hold sensitive identity data and photos, which is also why a mismatch
   message never repeats the name found on someone's ID.

   Throws with statusCode 503 only when PREMBLY_API_KEY is unset, which
   the routes surface as "not configured". Every provider-side failure
   (record not found, wallet out of credit, upstream down, timeout) throws
   with 422 or 502 instead, with a user-facing message, which the routes
   turn into a failed check. */

const PREMBLY_BASE_URL = (process.env.PREMBLY_BASE_URL || "https://api.prembly.com").replace(/\/$/, "");
const CHANNEL_PATH = "/api/v1/verification/api";
const REQUEST_TIMEOUT_MS = 20000;

const OUR_SIDE_DOWN = "We couldn't run this check because of a problem on VETRA's side. Try again later, or contact support@vetrahq.org if it keeps happening.";

// Prembly's own codes, returned inside the JSON body (often with HTTP 200).
// `label` is the ID being checked, e.g. "NIN" or "CAC registration".
function providerCodeMessage(code, label) {
  switch (code) {
    case "01": return `We couldn't find any ${label} with this number. Check the number and try again.`;
    case "02": return `The ${label} records service isn't responding right now, so we couldn't check it. Try again in a few minutes.`;
    case "03": return OUR_SIDE_DOWN;
    case "07": return `This ${label} is blocked by the issuer and can't be used for verification.`;
    default: return null;
  }
}
function httpMessage(status, label) {
  if (status === 401 || status === 403) return OUR_SIDE_DOWN;
  if (status === 429) return "Too many checks are running right now. Wait a minute and try again.";
  if (status === 400 || status === 422) return `The ${label} details weren't accepted. Check that you typed them exactly as printed and try again.`;
  if (status >= 500) return `The ${label} records service isn't responding right now, so we couldn't check it. Try again in a few minutes.`;
  return null;
}

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
    const value = record?.[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function displayName(person) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

// Compares the name on an ID record with the person's VETRA legal name.
// First and last name must match; a record that swaps them (surname
// first, common on Nigerian IDs) also passes. A middle name is only
// compared when both sides have one, since plenty of records leave it out.
// Returns null on a match, otherwise which part didn't match.
function nameMismatch(found, person) {
  const f = { first: normalizeName(found.firstName), middle: normalizeName(found.middleName), last: normalizeName(found.lastName) };
  const p = { first: normalizeName(person.firstName), middle: normalizeName(person.middleName), last: normalizeName(person.lastName) };
  if (!f.first || !f.last) return "unreadable";
  const middleOk = !f.middle || !p.middle || f.middle === p.middle;
  if (f.first === p.first && f.last === p.last && middleOk) return null;
  if (f.first === p.last && f.last === p.first) return null;
  if (f.first !== p.first && f.last !== p.last) return "both";
  if (f.first !== p.first) return "first";
  if (f.last !== p.last) return "last";
  return "middle";
}

// A record that only has a full name ("ADEBAYO JOHN OKAFOR"): first and
// last name each have to appear in it, in any order.
function fullNameMismatch(fullName, person) {
  const words = new Set(normalizeName(fullName).split(" ").filter(Boolean));
  if (!words.size) return "unreadable";
  const has = (name) => {
    const parts = normalizeName(name).split(" ").filter(Boolean);
    return parts.length > 0 && parts.every((w) => words.has(w));
  };
  const firstOk = has(person.firstName);
  const lastOk = has(person.lastName);
  if (firstOk && lastOk) return null;
  if (!firstOk && !lastOk) return "both";
  return firstOk ? "last" : "first";
}

function mismatchMessage(mismatch, label, person) {
  const name = displayName(person);
  const fix = `Your name on VETRA must be spelled the same way as on your ${label}. If your VETRA name is wrong, contact support@vetrahq.org to correct it.`;
  switch (mismatch) {
    case "unreadable":
      return `We found your ${label}, but the record has no readable name to compare with your VETRA name (${name}). Try a different ID.`;
    case "first":
      return `Your last name matches, but the first name on your ${label} doesn't match your VETRA first name (${person.firstName}). ${fix}`;
    case "last":
      return `Your first name matches, but the last name on your ${label} doesn't match your VETRA last name (${person.lastName}). ${fix}`;
    case "middle":
      return `Your first and last names match, but the middle name on your ${label} doesn't match your VETRA middle name (${person.middleName}). ${fix}`;
    default:
      return `The name on your ${label} doesn't match your VETRA name (${name}). ${fix}`;
  }
}

function personResult(mismatch, label, person) {
  return mismatch
    ? { verified: false, message: mismatchMessage(mismatch, label, person) }
    : { verified: true, message: `${label.charAt(0).toUpperCase()}${label.slice(1)} verified. The name matches your VETRA account.` };
}

async function request(channel, body, label) {
  if (!process.env.PREMBLY_API_KEY) {
    const error = new Error("Identity verification is not configured yet.");
    error.statusCode = 503;
    throw error;
  }

  let response;
  try {
    response = await fetch(`${PREMBLY_BASE_URL}${CHANNEL_PATH}/${channel}/`, {
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
    const error = new Error(cause.name === "TimeoutError"
      ? `The ${label} check took too long to respond. Try again in a few minutes.`
      : `We couldn't reach the ${label} records service. Try again in a few minutes.`);
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
    // The provider's own wording is logged for admins/devs, not shown.
    console.warn(`Prembly ${channel} failed: HTTP ${response.status}, code ${code || "-"}, ${payload.detail || payload.message || ""}`);
    const error = new Error(
      providerCodeMessage(code, label)
      || httpMessage(response.status, label)
      || `We couldn't verify your ${label}. Check the details and try again.`
    );
    error.statusCode = response.status >= 500 || code === "02" ? 502 : 422;
    throw error;
  }
  return payload;
}

async function verifyNin(nin, person) {
  const payload = await request("nin_basic", { number: nin }, "NIN");
  const record = payload.data || payload.nin_data || {};
  const found = {
    firstName: pick(record, ["firstname", "first_name", "firstName"]),
    middleName: pick(record, ["middlename", "middle_name", "middleName"]),
    lastName: pick(record, ["surname", "last_name", "lastName", "lastname"]),
  };
  return personResult(nameMismatch(found, person), "NIN", person);
}

async function verifyBvn(bvn, person) {
  const payload = await request("bvn_basic", { number: bvn }, "BVN");
  const record = payload.data || {};
  const found = {
    firstName: pick(record, ["firstName", "first_name", "firstname"]),
    middleName: pick(record, ["middleName", "middle_name", "middlename"]),
    lastName: pick(record, ["lastName", "last_name", "lastname", "surname"]),
  };
  return personResult(nameMismatch(found, person), "BVN", person);
}

// FRSC is sent the number and name. When the record comes back with name
// fields they're compared too; otherwise FRSC's own match is the answer.
async function verifyDriversLicence(licenceNumber, dateOfBirth, person) {
  const label = "driver's licence";
  const payload = await request("drivers_license_ng", {
    number: licenceNumber,
    first_name: person.firstName,
    last_name: person.lastName,
    ...(dateOfBirth ? { dob: dateOfBirth } : {}),
  }, label);
  const data = payload.data || {};
  const frsc = data.frsc_data || data;
  const found = {
    firstName: pick(frsc, ["firstName", "first_name", "firstname"]),
    middleName: pick(frsc, ["middleName", "middle_name", "middlename"]),
    lastName: pick(frsc, ["lastName", "last_name", "lastname", "surname"]),
  };
  if (found.firstName && found.lastName) return personResult(nameMismatch(found, person), label, person);
  if (data.status === false || frsc.verified === false) {
    return { verified: false, message: `The licence number and the name on your VETRA account (${displayName(person)}) don't match an FRSC record. Check the number, and that your VETRA name is spelled as on your licence.` };
  }
  return { verified: true, message: "Driver's licence verified. The name matches your VETRA account." };
}

// INEC needs the state and LGA the card was registered in, as printed.
async function verifyVotersCard(vin, person, { state, lga } = {}) {
  const label = "voter's card";
  // Our state list says "FCT (Abuja)"; INEC's field takes letters only.
  const inecState = /^FCT/i.test(String(state || "")) ? "FCT" : state;
  const payload = await request("voters_card", { number: vin, last_name: person.lastName, state: inecState, lga }, label);
  const record = payload.data || payload.vc_data || {};
  const first = pick(record, ["first_name", "firstName"]);
  const last = pick(record, ["last_name", "lastName", "surname"]);
  const mismatch = first && last
    ? nameMismatch({ firstName: first, lastName: last }, { ...person, middleName: null })
    : fullNameMismatch(pick(record, ["fullName", "full_name", "name"]), person);
  return personResult(mismatch, label, person);
}

// ---------- Business: CAC record + bank account name ----------

const COMPANY_TYPES = ["RC", "BN", "IT", "LP", "LLP"];
const COMPANY_TYPE_LABEL = {
  RC: "limited company (RC)",
  BN: "business name (BN)",
  IT: "incorporated trustees (IT)",
  LP: "limited partnership (LP)",
  LLP: "limited liability partnership (LLP)",
};

// "rc 123-456", "RC123456" and "123456" (+ type RC) all become
// { type: "RC", digits: "123456" }. A prefix typed in the number wins
// over the type picked. Returns null when there are no usable digits.
function parseCacNumber(input, fallbackType = "RC") {
  const compact = String(input || "").toUpperCase().replace(/[\s\-./]/g, "");
  const match = /^(LLP|RC|BN|IT|LP)?(\d{1,15})$/.exec(compact);
  if (!match) return null;
  const type = match[1] || (COMPANY_TYPES.includes(fallbackType) ? fallbackType : "RC");
  return { type, digits: match[2], display: `${type}${match[2]}` };
}

// Legal-form words and common bank abbreviations that differ between how
// CAC and banks write the same business name ("ABC NIG LTD" vs
// "ABC NIGERIA LIMITED"). Removed before comparing.
const BUSINESS_FILLER = new Set([
  "ltd", "limited", "plc", "llc", "llp", "lp", "inc", "co", "company", "and", "the",
  "nig", "nigeria", "ng", "rc", "bn", "enterprise", "enterprises", "ent", "int", "intl", "international",
]);

function businessWords(name) {
  return normalizeName(String(name || "").replace(/&/g, " and "))
    .split(" ")
    .filter((w) => w && !BUSINESS_FILLER.has(w));
}

// Bank account names are often cut short ("ABC GLOBAL SERVIC"), so every
// word on the bank side must be a word on the CAC side, the last one may
// be a cut-off prefix of one, and at least half of the CAC words must
// be covered.
function businessNamesMatch(bankName, companyName) {
  const bank = businessWords(bankName);
  const cac = businessWords(companyName);
  if (!bank.length || !cac.length) return false;
  const remaining = [...cac];
  for (let i = 0; i < bank.length; i += 1) {
    const isLast = i === bank.length - 1;
    let idx = remaining.indexOf(bank[i]);
    if (idx === -1 && isLast && bank[i].length >= 3) idx = remaining.findIndex((w) => w.startsWith(bank[i]));
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return bank.length * 2 >= cac.length;
}

// Looks the business up on CAC and checks that the payout bank account is
// in the business's registered name. `bankAccountName` is the
// bank-resolved name saved with the payout account (never typed by the
// vendor).
async function verifyBusiness(cac, bankAccountName) {
  const label = "CAC registration";
  const payload = await request("cac_basic", { rc_number: cac.digits, company_type: cac.type }, label);
  const record = payload.data || {};
  const companyName = pick(record, ["company_name", "companyName", "name", "business_name"]);
  const status = pick(record, ["company_status", "status"]);
  if (!companyName) {
    return { verified: false, message: `We found ${cac.display} on CAC, but the record has no business name to compare with your bank account. Contact support@vetrahq.org.` };
  }
  if (/inactive|struck|dissolved|wound|liquidat/i.test(status)) {
    return { verified: false, message: `CAC lists ${companyName} (${cac.display}) as ${status.toLowerCase()}. Only active businesses can be verified.` };
  }
  if (!businessNamesMatch(bankAccountName, companyName)) {
    return {
      verified: false,
      message: `Your payout bank account is in the name "${bankAccountName}", but ${cac.display} is registered on CAC as "${companyName}". `
        + "The bank account must be in your registered business name. Change your payout account on the Earnings page, or check that you entered the right CAC number and registration type.",
    };
  }
  return { verified: true, message: `CAC verified: ${companyName} (${cac.display}). Your bank account name matches.` };
}

module.exports = {
  verifyNin,
  verifyBvn,
  verifyDriversLicence,
  verifyVotersCard,
  verifyBusiness,
  parseCacNumber,
  businessNamesMatch,
  COMPANY_TYPES,
  COMPANY_TYPE_LABEL,
};
