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

const notifyEmail = () => clean(process.env.BREVO_NOTIFY_EMAIL || "rinkodanna@gmail.com", 320);

function makeOrderId(value) {
  const supplied = clean(value, 60);
  return /^RD-[A-Za-z0-9_-]{4,50}$/.test(supplied)
    ? supplied
    : `RD-${Date.now().toString().slice(-8)}`;
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
    ["Estimated total", total],
    ["Pricing breakdown", breakdown],
    ["Promo code", promo],
    ["Payment preference", paymentPreference],
    ["Instructions", instructions],
    ["Agreement", "Accepted"]
  ];
  const html = `<div style="font-family:Arial,sans-serif;color:#17304d"><h2>New Rinko Delivery order request</h2><table style="border-collapse:collapse">${htmlRows(fields)}</table></div>`;
  const text = `New Rinko Delivery order request\n\n${textRows(fields)}`;

  try {
    await upsertContact(email);

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
