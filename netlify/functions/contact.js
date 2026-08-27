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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options(event);
  if (event.httpMethod !== "POST") return json(event, 405, { ok: false, error: "Method not allowed" });
  if (!requestIsAllowed(event)) return json(event, 403, { ok: false, error: "Request origin not allowed" });

  const data = parseBody(event);
  if (!data) return json(event, 400, { ok: false, error: "Invalid request body" });
  if (clean(data.website, 200)) return json(event, 400, { ok: false, error: "Invalid request" });

  const name = clean(data.name, 160);
  const email = clean(data.email, 320);
  const company = clean(data.company, 160);
  const service = clean(data.service_needed, 120);
  const message = clean(data.message, 4000);
  const terms = clean(data.terms_agreement, 80);

  if (!name || !email || !service || !message || terms.toLowerCase() !== "accepted" || !emailIsValid(email)) {
    return json(event, 400, { ok: false, error: "Please complete the required fields" });
  }

  const fields = [
    ["Name", name],
    ["Email", email],
    ["Company", company],
    ["Service requested", service],
    ["Message", message],
    ["Agreement", "Accepted"]
  ];
  const html = `<div style="font-family:Arial,sans-serif;color:#17304d"><h2>New Rinko Delivery quote request</h2><table style="border-collapse:collapse">${htmlRows(fields)}</table></div>`;
  const text = `New Rinko Delivery quote request\n\n${textRows(fields)}`;

  try {
    await upsertContact(email, process.env.BREVO_CONTACT_LIST_ID);

    await sendEmail({
      toEmail: notifyEmail(),
      toName: "Rinko Delivery",
      subject: `New quote request from ${name}`,
      htmlContent: html,
      textContent: text,
      replyTo: { email, name },
      tag: "website-contact",
      template: process.env.BREVO_CONTACT_NOTIFY_TEMPLATE_ID,
      params: { NAME: name, EMAIL: email, COMPANY: company, SERVICE: service, MESSAGE: message }
    });

    await trackEvent("contact_form_submitted", email, {
      service,
      company: company || undefined,
      source: "rinko-website"
    });

    if (String(process.env.BREVO_SEND_AUTOREPLY || "false").toLowerCase() !== "false") {
      try {
        await sendEmail({
          toEmail: email,
          toName: name,
          subject: "We received your Rinko Delivery request",
          htmlContent: `<div style="font-family:Arial,sans-serif;color:#17304d"><h2>Thanks for contacting Rinko Delivery, ${escapeHtml(name)}</h2><p>We received your request and will review availability before confirming your delivery.</p><p>We will follow up by email if we need more details.</p></div>`,
          textContent: `Thanks for contacting Rinko Delivery, ${name}.\n\nWe received your request and will review availability before confirming your delivery. We will follow up by email if we need more details.`,
          replyTo: { email: notifyEmail(), name: "Rinko Delivery" },
          tag: "website-contact-autoreply",
          template: process.env.BREVO_CONTACT_AUTOREPLY_TEMPLATE_ID,
          params: { NAME: name, SERVICE: service }
        });
      } catch (error) {
        console.error("Brevo contact auto-reply failed:", error.message);
      }
    }

    return json(event, 200, { ok: true });
  } catch (error) {
    console.error("Brevo contact notification failed:", error.message);
    return json(event, 500, { ok: false, error: "Unable to send the request right now" });
  }
};
