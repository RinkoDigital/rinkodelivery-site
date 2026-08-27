// Stripe calls this endpoint directly (never the browser) whenever a
// Checkout session's status changes. It is the only place that marks an
// order "paid" — the success_url the customer is redirected to is just a
// friendly page, it does NOT prove payment by itself, since a URL can be
// visited without paying. Configure this URL in the Stripe Dashboard →
// Developers → Webhooks as:  https://yourdomain.com/api/stripe-webhook
// (see the setup guide for the exact steps).
const { getServiceClient } = require("../lib/supabase");

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

      const query = client.from("rinko_orders").update({
        payment_status: paymentStatus,
        stripe_payment_intent_id: session.payment_intent || null
      });

      const { error } = orderId
        ? await query.eq("id", orderId)
        : await query.eq("stripe_checkout_session_id", session.id);

      if (error) console.error("Failed to update order after Stripe payment:", error.message);
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
