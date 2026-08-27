const { clean } = require("./brevo");

/**
 * Internal, non-public promo rules — shared by promo.js (validates a code
 * typed on the site) and order.js (re-validates every submission before it
 * is emailed, instead of trusting whatever the browser sent).
 *
 * This file only ever runs on Netlify's servers. Override the actual code
 * strings without a redeploy via environment variables:
 *   INTERNAL_WAIVER_CODE  (default SENIORHEAVY)
 *   CARE_DISCOUNT_CODE    (default CARE20)
 */
function getInternalRules() {
  const waiverCode = clean(process.env.INTERNAL_WAIVER_CODE || "SENIORHEAVY", 60).toUpperCase();
  const careCode = clean(process.env.CARE_DISCOUNT_CODE || "CARE20", 60).toUpperCase();
  return {
    [waiverCode]: { discountPercent: 0, waiveHeavyFee: true, label: "Internal heavy-item waiver" },
    [careCode]: { discountPercent: 0.20, waiveHeavyFee: true, label: "Internal care discount + heavy-item waiver" }
  };
}

// Default public codes. These are meant to be public (shared with
// customers), so keeping them here too just lets order.js sanity-check
// totals — it's not a secrecy boundary the way the internal rules are.
// If the site owner renames these via the in-browser admin panel, that
// change lives only in that browser's localStorage and this default won't
// know about it — the mismatch flag below is a signal for a human to
// check, not a hard rejection.
function getDefaultPublicRules() {
  return {
    RINKO10: { discountPercent: 0.10, waiveHeavyFee: false, label: "RINKO10 promo" },
    RINKO15: { discountPercent: 0.15, waiveHeavyFee: false, label: "RINKO15 promo" },
    RINKO20: { discountPercent: 0.20, waiveHeavyFee: false, label: "RINKO20 promo" }
  };
}

function normalizeCode(value) {
  return clean(value, 60).toUpperCase().replace(/\s+/g, "");
}

module.exports = { getInternalRules, getDefaultPublicRules, normalizeCode };
