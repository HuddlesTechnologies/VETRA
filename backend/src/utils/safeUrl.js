/* =========================================================
   User-supplied URLs (product images and video, avatars, store
   covers, banners, report attachments, delivery proof photos) end up
   inside HTML attributes like <img src="...">. Accepting any string
   let a value such as `x" onerror="...` break out of the attribute
   and run script in whoever viewed it, admins included.

   safeHttpsUrl() accepts only a well-formed https:// URL and returns
   the parser's normalized form, in which quotes, spaces and angle
   brackets are percent-encoded, so the stored value can never close
   the attribute it's placed in.
   ========================================================= */

function safeHttpsUrl(value) {
  if (typeof value !== "string" || value.length > 1000) return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return parsed.href;
}

// For an optional field: undefined/null/"" mean "no URL" and pass
// through as null; anything else must be a valid https URL.
function optionalHttpsUrl(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const url = safeHttpsUrl(value);
  if (!url) throw Object.assign(new Error("Links must be full https:// URLs, use the upload button."), { status: 400 });
  return url;
}

function httpsUrlList(value, { max = 10 } = {}) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw Object.assign(new Error("Expected a list of URLs."), { status: 400 });
  if (value.length > max) throw Object.assign(new Error(`At most ${max} files.`), { status: 400 });
  return value.map((v) => {
    const url = safeHttpsUrl(v);
    if (!url) throw Object.assign(new Error("Links must be full https:// URLs, use the upload button."), { status: 400 });
    return url;
  });
}

module.exports = { safeHttpsUrl, optionalHttpsUrl, httpsUrlList };
