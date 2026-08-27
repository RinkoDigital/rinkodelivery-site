const {
  json,
  options,
  parseBody,
  requestIsAllowed
} = require("../lib/brevo");
const { getInternalRules, normalizeCode } = require("../lib/promo-rules");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options(event);
  if (event.httpMethod !== "POST") return json(event, 405, { ok: false, error: "Method not allowed" });
  if (!requestIsAllowed(event)) return json(event, 403, { ok: false, error: "Request origin not allowed" });

  const data = parseBody(event);
  if (!data) return json(event, 400, { ok: false, error: "Invalid request body" });

  const code = normalizeCode(data.code);
  if (!code) return json(event, 200, { ok: true, valid: false });

  const rule = getInternalRules()[code];
  if (!rule) return json(event, 200, { ok: true, valid: false });

  // Deliberately does NOT echo the full rule table — only confirms/denies
  // the exact code that was submitted, so the code list can't be enumerated.
  return json(event, 200, {
    ok: true,
    valid: true,
    discountPercent: rule.discountPercent,
    waiveHeavyFee: rule.waiveHeavyFee,
    label: rule.label
  });
};
