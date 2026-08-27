const {
  clean,
  emailIsValid,
  escapeHtml,
  htmlRows,
  json,
  options,
  parseBody,
  requestIsAllowed,
  sendEmail,
  textRows,
  trackEvent,
  upsertContact
} = require("../lib/brevo");
const { getInternalRules, getDefaultPublicRules, normalizeCode } = require("../lib/promo-rules");

const notifyEmail = () => clean(process.env.BREVO_NOTIFY_EMAIL || "rinkodanna@gmail.com", 320);

function makeOrderId(value) {
  const supplied = clean(value, 60);
  return /^RD-[A-Za-z0-9_-]{4,50}$/.test(supplied)
    ? supplied
    : `RD-${Date.now().toString().slice(-8)}`;
}

// Mirrors the default pricing engine in order.html (base by item size,
// $2.10/mi, $15 heavy-item fee over 20lb, speed fees). Independently
// recomputes the total server-side so a forged "estimated_total" hidden
// field doesn't go unnoticed — this does NOT block the request (everything
// is reviewed by a person before confirming either way), it just flags a
// mismatch for that reviewer. If prices were customized through the
// in-browser admin panel (which is per-browser localStorage, not shared
// with this function), this recheck won't reflect that customization —
// treat "could not verify" as "check manually," not as an error.
const SIZE_BASE = { Small: 5, Medium: 8, Large: 12 };
const SPEED_FEE = { "Standard Same-Day": 0, "Express Priority": 15, Scheduled: 0 };
const SEDAN_PER_MILE = 2.10;
const HEAVY_FEE = 15;

function verifyTotal({ itemSize, speed, distanceMiles, weight, promoCode }) {
  const base = SIZE_BASE[itemSize];
  const speedFee = SPEED_FEE[speed];
  if (base == null || speedFee == null || !Number.isFinite(distanceMiles) || distanceMiles <= 0) {
    return null;
  }

  const distanceFee = Math.round(distanceMiles * SEDAN_PER_MILE * 100) / 100;
  const rawHeavyFee = String(weight || "").includes("Over 20") ? HEAVY_FEE : 0;

  const code = normalizeCode(promoCode);
  const rule = code ? (getInternalRules()[code] || getDefaultPublicRules()[code] || null) : null;
  const heavyFee = rule && rule.waiveHeavyFee ? 0 : rawHeavyFee;

  const subtotal = Math.round((base + distanceFee + speedFee + heavyFee) * 100) / 100;
  const discountAmount = Math.round(subtotal * (rule ? rule.discountPercent : 0) * 100) / 100;
  const total = Math.round((subtotal - discountAmount) * 100) / 100;

  return { total, promoRecognized: Boolean(rule), promoLabel: rule ? rule.label : (code ? "Unrecognized code" : "No code") };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options(event);
  if (event.httpMethod !== "POST") return json(event, 405, { ok: false, error: "Method not allowed" });
  if (!requestIsAllowed(event)) return json(event, 403, { ok: false, error: "Request origin not allowed" });

  const data = parseBody(event);
  if (!data) return json(event, 400, { ok: false, error: "Invalid request body" });
  if (clean(data.website, 200)) return json(event, 400, { ok: false, error: "Invalid request" });

  const orderId = makeOrderId(data.order_id);
  const name = clean(data.name, 160);
  const email = clean(data.email, 320);
  const phone = clean(data.phone, 80);
  const company = clean(data.company, 160);
  const pickup = clean(data.pickup_address, 500);
  const dropoff = clean(data.dropoff_address, 500);
  const distance = clean(data.distance_miles, 40);
  const preferredTime = clean(data.preferred_time, 80);
  const itemSize = clean(data.item_size, 80);
  const packageType = clean(data.package_type, 120);
  const weight = clean(data.estimated_weight, 120);
  const speed = clean(data.delivery_speed, 100);
  const total = clean(data.estimated_total, 80);
  const breakdown = clean(data.pricing_breakdown, 2000);
  const promo = clean(data.promo_code, 120);
  const paymentPreference = clean(data.payment_preference, 160);
  const instructions = clean(data.instructions, 3000);
  const terms = clean(data.terms_agreement, 80);
  const distanceNumber = Number(distance);

  if (!name || !email || !pickup || !dropoff || !itemSize || !speed || !emailIsValid(email) || terms.toLowerCase() !== "accepted" || !Number.isFinite(distanceNumber) || distanceNumber <= 0) {
    return json(event, 400, { ok: false, error: "Please complete the required fields" });
  }

  const verified = verifyTotal({ itemSize, speed, distanceMiles: distanceNumber, weight, promoCode: promo });
  const clientTotalNumber = Number(String(total).replace(/[^0-9.-]/g, ""));
  let priceCheck;
  if (!verified) {
    priceCheck = "Could not independently verify (unrecognized size/speed combo, or custom admin pricing) — review manually.";
  } else {
    const diff = Number.isFinite(clientTotalNumber) ? Math.abs(clientTotalNumber - verified.total) : null;
    priceCheck = (diff === null || diff > 0.05)
      ? `MISMATCH — server recalculates $${verified.total.toFixed(2)} (site sent ${total || "nothing"}). Verify before confirming.`
      : `OK — matches server recalculation ($${verified.total.toFixed(2)}).`;
  }
  const promoCheck = !promo
    ? "No code entered"
    : verified
      ? (verified.promoRecognized ? `Recognized — ${verified.promoLabel}` : "NOT recognized by the server — do not honor unless verified another way")
      : "Not checked (see price check above)";

  const fields = [
    ["Order ID", orderId],
    ["Customer", name],
    ["Email", email],
    ["Phone", phone],
    ["Company", company],
    ["Pickup", pickup],
    ["Drop-off", dropoff],
    ["Distance", `${distance} mi`],
    ["Preferred time", preferredTime],
    ["Item size", itemSize],
    ["Package type", packageType],
    ["Estimated weight", weight],
    ["Delivery speed", speed],
    ["Estimated total (site)", total],
    ["Price check (server)", priceCheck],
    ["Pricing breakdown", breakdown],
    ["Promo code", promo],
    ["Promo check (server)", promoCheck],
    ["Payment preference", paymentPreference],
    ["Instructions", instructions],
    ["Agreement", "Accepted"]
  ];
  const html = `<div style="font-family:Arial,sans-serif;color:#17304d"><h2>New Rinko Delivery order request</h2><table style="border-collapse:collapse">${htmlRows(fields)}</table></div>`;
  const text = `New Rinko Delivery order request\n\n${textRows(fields)}`;

  try {
    await upsertContact(email, process.env.BREVO_ORDER_LIST_ID);

    await sendEmail({
      toEmail: notifyEmail(),
      toName: "Rinko Delivery",
      subject: `New delivery request ${orderId}`,
      htmlContent: html,
      textContent: text,
      replyTo: { email, name },
      tag: "website-order",
      template: process.env.BREVO_ORDER_NOTIFY_TEMPLATE_ID,
      params: {
        ORDER_ID: orderId,
        NAME: name,
        EMAIL: email,
        PICKUP: pickup,
        DROPOFF: dropoff,
        DISTANCE: distance,
        ITEM_SIZE: itemSize,
        SPEED: speed,
        TOTAL: total,
        BREAKDOWN: breakdown,
        INSTRUCTIONS: instructions
      }
    });

    await trackEvent("order_request_submitted", email, {
      order_id: orderId,
      estimated_total: total,
      distance_miles: distanceNumber,
      item_size: itemSize,
      delivery_speed: speed,
      source: "rinko-website"
    });

    if (String(process.env.BREVO_SEND_AUTOREPLY || "false").toLowerCase() !== "false") {
      try {
        await sendEmail({
          toEmail: email,
          toName: name,
          subject: `Rinko Delivery request received — ${orderId}`,
          htmlContent: `<div style="font-family:Arial,sans-serif;color:#17304d"><h2>Request received</h2><p>Hi ${escapeHtml(name)},</p><p>We received your delivery request <strong>${escapeHtml(orderId)}</strong>.</p><p>Estimated total: <strong>${escapeHtml(total)}</strong></p><p>We will review the route and availability before confirming pickup.</p></div>`,
          textContent: `Hi ${name},\n\nWe received your delivery request ${orderId}.\nEstimated total: ${total}\n\nWe will review the route and availability before confirming pickup.`,
          replyTo: { email: notifyEmail(), name: "Rinko Delivery" },
          tag: "website-order-autoreply",
          template: process.env.BREVO_ORDER_AUTOREPLY_TEMPLATE_ID,
          params: { ORDER_ID: orderId, NAME: name, TOTAL: total }
        });
      } catch (error) {
        console.error("Brevo order auto-reply failed:", error.message);
      }
    }

    return json(event, 200, { ok: true, orderId });
  } catch (error) {
    console.error("Brevo order notification failed:", error.message);
    return json(event, 500, { ok: false, error: "Unable to send the request right now" });
  }
};
