const CHECKID_BASE_URL = (process.env.CHECKID_BASE_URL || "https://sandbox.checkid.ng").replace(/\/$/, "");

function providerError(payload, fallback) {
  return payload?.message || payload?.error || payload?.data?.message || fallback;
}

function isVerified(payload) {
  const providerStatus = String(payload?.data?.status?.status || "").toLowerCase();
  const summary = JSON.stringify(payload?.data?.summary || {}).toLowerCase();
  const message = String(payload?.message || "").toLowerCase();
  return providerStatus === "verified" || summary.includes("verified") || message.includes("verified");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function identityName(payload) {
  const data = payload?.data || {};
  const license = data.drivers_license || {};
  return {
    firstName: license.firstname || data.firstName || data.firstname || "",
    middleName: license.middlename || data.middleName || data.middlename || "",
    lastName: license.lastname || data.surname || data.lastName || data.lastname || "",
  };
}

async function request(path, { form, json }) {
  if (!process.env.CHECKID_API_KEY) {
    const error = new Error("Identity verification is not configured yet.");
    error.statusCode = 503;
    throw error;
  }

  const headers = { Authorization: `Bearer ${process.env.CHECKID_API_KEY}` };
  let body;
  if (form) {
    body = new FormData();
    for (const [key, value] of Object.entries(form)) body.append(key, value);
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }

  const response = await fetch(`${CHECKID_BASE_URL}${path}`, { method: "POST", headers, body });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(providerError(payload, `CheckID.ng returned HTTP ${response.status}.`));
    error.statusCode = response.status >= 500 ? 502 : 422;
    throw error;
  }

  return {
    verified: isVerified(payload),
    message: providerError(payload, "Verification completed."),
    identityName: identityName(payload),
    payload,
  };
}

function verifyNin(vnin) {
  return request("/api/v1/identity/nin", { form: { vnin } });
}

function verifyDriversLicense(licenseNumber, firstname, lastname) {
  return request("/api/v1/identity/drivers_license", {
    form: { licenseNumber, firstname, lastname },
  });
}

function verifyCac(regNumber) {
  return request("/api/v1/identity/cac/basic", { json: { regNumber } });
}

module.exports = { verifyNin, verifyDriversLicense, verifyCac, normalizeName };
