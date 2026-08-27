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
const { getServiceClient } = require("../lib/supabase");

const notifyEmail = () => clean(process.env.BREVO_NOTIFY_EMAIL || "rinkodanna@gmail.com", 320);

function makeOrderId(value) {
  const supplied = clean(value, 60);
  return /^RD-[A-Za-z0-9_-]{4,50}$/.test(supplied)
    ? supplied
    : `RD-${Date.now().toString().slice(-8)}`;
}

// Fallback pricing — used only if the live settings can't be read from
// Supabase (e.g. Supabase isn't configured yet, or the request fails).
// Mirrors the default pricing engine in order.html.
const FALLBACK_SETTINGS = {
  small_base: 5,
  medium_base: 8,
  large_base: 12,
  per_mile: 2.10,
  express_fee: 15,
  heavy_fee: 15
};

// Loads the live pricing settings the admin dashboard controls
// (rinko_settings, id='main'). Falls back to the hardcoded defaults
// above so the order form keeps working even before Supabase is set up.
async function loadLiveSettings() {
  try {
    const client = getServiceClient();
    const { data, error } = await client.from("rinko_settings").select("*").eq("id", "main").single();
    if (error || !data) return FALLBACK_SETTINGS;
    return data;
  } catch (error) {
    return FALLBACK_SETTINGS;
  }
}

// Checks a promo code against, in order: the internal (non-public) rules,
// the default public codes, then any custom coupon created in the admin
// dashboard (Supabase). Returns null if nothing matches.
async function resolvePromo(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;

  const internal = getInternalRules()[code];
  if (internal) return { ...internal, source: "internal", row: null };

  const publicRule = getDefaultPublicRules()[code];
  if (publicRule) return { ...publicRule, source: "default", row: null };

  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("rinko_coupons")
      .select("*")
      .eq("code", code)
      .eq("active", true)
      .maybeSingle();
    if (error || !data) return null;

    if (data.expires_at && new Date(data.expires_at) <= new Date()) return null;
    if (data.usage_limit && Number(data.used_count || 0) >= Number(data.usage_limit)) return null;

    return {
      discountPercent: Number(data.discount_percent) / 100,
      waiveHeavyFee: false,
      label: `Coupon ${data.code}`,
      source: "coupon",
      row: data
    };
  } catch (error) {
    return null;
  }
}

async function verifyTotal({ itemSize, speed, distanceMiles, weight, promoCode }) {
  const settings = await loadLiveSettings();
  const SIZE_BASE = { Small: Number(settings.small_base), Medium: Number(settings.medium_base), Large: Number(settings.large_base) };
  const SPEED_FEE = { "Standard Same-Day": 0, "Express Priority": Number(settings.express_fee), Scheduled: 0 };
  const perMile = Number(settings.per_mile);
  const heavyFeeBase = Number(settings.heavy_fee);

  const base = SIZE_BASE[itemSize];
  const speedFee = SPEED_FEE[speed];
  if (base == null || speedFee == null || !Number.isFinite(distanceMiles) || distanceMiles <= 0) {
    return null;
  }

  const distanceFee = Math.round(distanceMiles * perMile * 100) / 100;
  const rawHeavyFee = String(weight || "").includes("Over 20") ? heavyFeeBase : 0;

  const rule = await resolvePromo(promoCode);
  const heavyFee = rule && rule.waiveHeavyFee ? 0 : rawHeavyFee;

  const subtotal = Math.round((base + distanceFee + speedFee + heavyFee) * 100) / 100;
  const discountAmount = Math.round(subtotal * (rule ? rule.discountPercent : 0) * 100) / 100;
  const total = Math.round((subtotal - discountAmount) * 100) / 100;

  return {
    total,
    subtotal,
    base,
    distanceFee,
    speedFee,
    heavyFee,
    discountAmount,
    promoRecognized: Boolean(rule),
    promoLabel: rule ? rule.label : (promoCode ? "Unrecognized code" : "No code"),
    promoRow: rule ? rule.row : null
  };
}

// Saves the order to Supabase (source of truth for the admin/contractor
// dashboards). Returns the inserted row, or null if Supabase isn't
// configured / the insert fails — callers must keep working either way,
// since the email notification is still the fallback record.
async function saveOrderToDatabase({ orderId, name, email, phone, company, pickup, dropoff, distanceNumber, preferredTime, itemSize, packageType, weight, speed, promo, instructions, verified }) {
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("rinko_orders")
      .insert({
        order_code: orderId,
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        company,
        pickup_address: pickup,
        dropoff_address: dropoff,
        distance_miles: distanceNumber,
        preferred_time: preferredTime,
        item_size: itemSize,
        package_type: packageType,
        estimated_weight: weight,
        delivery_speed: speed,
        promo_code: promo || null,
        pricing_breakdown: verified ? {
          base: verified.base,
          distanceFee: verified.distanceFee,
          speedFee: verified.speedFee,
          heavyFee: verified.heavyFee,
          discountAmount: verified.discountAmount,
          promoLabel: verified.promoLabel
        } : null,
        total: verified ? verified.total : 0,
        instructions
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase order insert failed:", error.message);
      return null;
    }

    // Track usage only for admin-created coupons (Supabase rows) — the
    // internal/default codes aren't metered.
    if (verified && verified.promoRow) {
      await client
        .from("rinko_coupons")
        .update({ used_count: Number(verified.promoRow.used_count || 0) + 1 })
        .eq("id", verified.promoRow.id);
    }

    return data;
  } catch (error) {
    console.error("Supabase not configured or unreachable:", error.message);
    return null;
  }
}

// Creates a Stripe Checkout session for the order total, so the customer
// pays immediately instead of the business sending a manual invoice.
// Returns null (never throws) if Stripe isn't configured yet, or the
// order couldn't be saved to the database (nothing to reconcile the
// payment against later).
async function createCheckout({ orderRow, event, name, email }) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || !orderRow) return null;

  try {
    const Stripe = require("stripe");
    const stripe = Stripe(secretKey);

    const origin = process.env.SITE_URL || (event.headers && (event.headers.origin || event.headers.Origin)) || "https://rinkodelivery.com";
    const amountCents = Math.round(Number(orderRow.total) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return null;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: emailIsValid(email) ? email : undefined,
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: `Rinko Delivery — Order ${orderRow.order_code}`,
            description: `${orderRow.pickup_address} → ${orderRow.dropoff_address}`
          }
        },
        quantity: 1
      }],
      metadata: { order_id: orderRow.id, order_code: orderRow.order_code },
      success_url: `${origin}/thank-you.html?order=${encodeURIComponent(orderRow.order_code)}&paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/order.html?cancelled=1`
    });

    const client = getServiceClient();
    await client.from("rinko_orders").update({ stripe_checkout_session_id: session.id }).eq("id", orderRow.id);

    return session.url;
  } catch (error) {
    console.error("Stripe checkout session failed:", error.message);
    return null;
  }
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

  const verified = await verifyTotal({ itemSize, speed, distanceMiles: distanceNumber, weight, promoCode: promo });
  const clientTotalNumber = Number(String(total).replace(/[^0-9.-]/g, ""));
  let priceCheck;
  if (!verified) {
    priceCheck = "Could not independently verify (unrecognized size/speed combo) — review manually.";
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

  // The database row uses the server-verified total (falls back to the
  // browser's number only if verification wasn't possible), so a forged
  // client-side total never becomes the amount actually charged.
  const orderRow = await saveOrderToDatabase({
    orderId, name, email, phone, company, pickup, dropoff, distanceNumber,
    preferredTime, itemSize, packageType, weight, speed, promo, instructions,
    verified: verified || (Number.isFinite(clientTotalNumber) ? { total: clientTotalNumber, base: null, distanceFee: null, speedFee: null, heavyFee: null, discountAmount: null, promoLabel: promoCheck, promoRow: null } : null)
  });

  const checkoutUrl = await createCheckout({ orderRow, event, name, email });

  const fields = [
    ["Order ID", orderId],
    ["Saved to database", orderRow ? "Yes" : "NO — check Supabase configuration"],
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
    ["Payment link sent", checkoutUrl ? "Yes (Stripe Checkout)" : "No — Stripe not configured or amount invalid"],
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

    return json(event, 200, { ok: true, orderId, checkoutUrl });
  } catch (error) {
    console.error("Brevo order notification failed:", error.message);
    // The order may already be safely saved in Supabase and/or Stripe even
    // though the notification email failed — don't hide the checkout link.
    if (checkoutUrl) return json(event, 200, { ok: true, orderId, checkoutUrl, emailWarning: true });
    return json(event, 500, { ok: false, error: "Unable to send the request right now" });
  }
};
