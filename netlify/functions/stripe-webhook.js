// Stripe calls this endpoint directly (never the browser) whenever a
// Checkout session's status changes. It is the only place that marks an
// order "paid" — the success_url the customer is redirected to is just a
// friendly page, it does NOT prove payment by itself, since a URL can be
// visited without paying. Configure this URL in the Stripe Dashboard →
// Developers → Webhooks as:  https://yourdomain.com/api/stripe-webhook
// (see the setup guide for the exact steps).
const { getServiceClient } = require("../lib/supabase");
const { sendEmail, escapeHtml, emailIsValid } = require("../lib/brevo");

function getOrigin() {
  return process.env.SITE_URL || "https://www.rinkodelivery.com";
}

// Sends the customer their payment-confirmed email, with the tracking
// link, the moment Stripe confirms the charge — this is the only
// customer-facing email in the whole flow, so a failure here must never
// break the webhook response (Stripe would just retry and re-attempt
// the DB update pointlessly). Errors are logged, never thrown.
async function sendPaidConfirmation(orderRow) {
  if (!orderRow || !emailIsValid(orderRow.customer_email)) return;

  const origin = getOrigin();
  const trackingUrl = orderRow.tracking_token ? `${origin}/rastreio.html?t=${encodeURIComponent(orderRow.tracking_token)}` : null;
  const name = orderRow.customer_name || "there";
  const total = orderRow.total != null ? `$${Number(orderRow.total).toFixed(2)}` : "";

  try {
    await sendEmail({
      toEmail: orderRow.customer_email,
      toName: orderRow.customer_name,
      subject: `Payment received — Rinko Delivery order ${orderRow.order_code}`,
      htmlContent: `<div style="font-family:Arial,sans-serif;color:#17304d">
        <h2>Payment received</h2>
        <p>Hi ${escapeHtml(name)},</p>
        <p>We received your payment for order <strong>${escapeHtml(orderRow.order_code)}</strong>${total ? ` (${escapeHtml(total)})` : ""}.</p>
        <p>${escapeHtml(orderRow.pickup_address || "")} → ${escapeHtml(orderRow.dropoff_address || "")}</p>
        ${trackingUrl ? `<p><a href="${escapeHtml(trackingUrl)}" style="display:inline-block;background:#ff8a2a;color:#04162c;font-weight:bold;text-decoration:none;padding:12px 20px;border-radius:999px;">Track your delivery</a></p>` : ""}
        <p>We'll update the tracking page as your delivery is assigned, picked up, and delivered.</p>
      </div>`,
      textContent: `Hi ${name},\n\nWe received your payment for order ${orderRow.order_code}${total ? ` (${total})` : ""}.\n${orderRow.pickup_address || ""} -> ${orderRow.dropoff_address || ""}\n${trackingUrl ? `\nTrack your delivery: ${trackingUrl}\n` : ""}\nWe'll update the tracking page as your delivery is assigned, picked up, and delivered.`,
      tag: "order-payment-confirmed"
    });
  } catch (error) {
    console.error("Payment-confirmed email failed:", error.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error("Stripe webhook received but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are not configured");
    return { statusCode: 500, body: "Stripe not configured" };
  }

  const Stripe = require("stripe");
  const stripe = Stripe(secretKey);

  // Signature verification needs the exact raw request body — do not
  // JSON.parse it before this step.
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : (event.body || "");
  const signature = (event.headers && (event.headers["stripe-signature"] || event.headers["Stripe-Signature"])) || "";

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error.message);
    return { statusCode: 400, body: `Webhook signature verification failed: ${error.message}` };
  }

  try {
    if (stripeEvent.type === "checkout.session.completed" || stripeEvent.type === "checkout.session.async_payment_succeeded") {
      const session = stripeEvent.data.object;
      const client = getServiceClient();

      const orderId = session.metadata && session.metadata.order_id;
      const paymentStatus = session.payment_status === "paid" ? "paid" : "unpaid";

      // Look up the order first (by id when Checkout metadata has it,
      // otherwise by the session id) so we know its payment_status BEFORE
      // this update — Stripe retries webhook delivery on anything but a
      // clean 200, so without this check a retry would email the customer
      // a second "payment received" message for the same order.
      const lookup = client.from("rinko_orders").select("*");
      const { data: existing } = orderId
        ? await lookup.eq("id", orderId).maybeSingle()
        : await lookup.eq("stripe_checkout_session_id", session.id).maybeSingle();

      const wasAlreadyPaid = existing && existing.payment_status === "paid";

      const query = client.from("rinko_orders").update({
        payment_status: paymentStatus,
        stripe_payment_intent_id: session.payment_intent || null
      });

      const { data: updated, error } = existing
        ? await query.eq("id", existing.id).select().single()
        : (orderId ? await query.eq("id", orderId).select().maybeSingle() : await query.eq("stripe_checkout_session_id", session.id).select().maybeSingle());

      if (error) console.error("Failed to update order after Stripe payment:", error.message);

      if (!error && !wasAlreadyPaid && paymentStatus === "paid") {
        await sendPaidConfirmation(updated || existing);
      }
    }

    if (stripeEvent.type === "checkout.session.async_payment_failed" || stripeEvent.type === "checkout.session.expired") {
      const session = stripeEvent.data.object;
      const client = getServiceClient();
      const orderId = session.metadata && session.metadata.order_id;
      const query = client.from("rinko_orders").update({ payment_status: "failed" });
      const { error } = orderId
        ? await query.eq("id", orderId)
        : await query.eq("stripe_checkout_session_id", session.id);
      if (error) console.error("Failed to mark order payment as failed:", error.message);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error("Stripe webhook handling error:", error.message);
    // Return 200 anyway once the signature is verified — Stripe retries on
    // non-2xx, and retrying won't fix a bug in this handler. Log it instead.
    return { statusCode: 200, body: JSON.stringify({ received: true, warning: "handler error, check logs" }) };
  }
};
