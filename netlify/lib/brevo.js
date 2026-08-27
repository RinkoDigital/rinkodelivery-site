const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getHeader(event, name) {
  const headers = event && event.headers ? event.headers : {};
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((header) => header.toLowerCase() === target);
  return key ? String(headers[key] || "") : "";
}

function getAllowedOrigin(origin) {
  if (!origin) return "";

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    const isRinkoHost = hostname === "rinkodelivery.com" || hostname === "www.rinkodelivery.com";
    const isNetlifyPreview = hostname.endsWith(".netlify.app");
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    return isRinkoHost || isNetlifyPreview || isLocalhost ? origin : "";
  } catch (error) {
    return "";
  }
}

function corsHeaders(event) {
  const origin = getAllowedOrigin(getHeader(event, "origin"));
  return {
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {})
  };
}

function json(event, statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(event)
    },
    body: JSON.stringify(body)
  };
}

function options(event) {
  return json(event, 204, null);
}

function parseBody(event) {
  let raw = event && event.body ? String(event.body) : "";
  if (event && event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return null;
  }
}

function clean(value, maxLength = 2000) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function emailIsValid(value) {
  return EMAIL_PATTERN.test(clean(value, 320));
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function htmlRows(fields) {
  return fields
    .filter(([, value]) => value !== "" && value != null)
    .map(([label, value]) => `<tr><th style="padding:8px 12px;text-align:left;vertical-align:top;color:#526173">${escapeHtml(label)}</th><td style="padding:8px 12px;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`)
    .join("");
}

function textRows(fields) {
  return fields
    .filter(([, value]) => value !== "" && value != null)
    .map(([label, value]) => `${label}: ${clean(value)}`)
    .join("\n");
}

async function brevoRequest(path, body) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured");

  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  let responseBody = null;
  try {
    responseBody = await response.json();
  } catch (error) {
    responseBody = null;
  }

  if (!response.ok) {
    const detail = responseBody && (responseBody.message || responseBody.code);
    throw new Error(`Brevo ${path} failed (${response.status}${detail ? `: ${detail}` : ""})`);
  }

  return responseBody;
}

function sender() {
  const email = clean(process.env.BREVO_SENDER_EMAIL || "rinkodanna@gmail.com", 320);
  if (!emailIsValid(email)) throw new Error("BREVO_SENDER_EMAIL is invalid");
  return {
    email,
    name: clean(process.env.BREVO_SENDER_NAME || "Rinko Delivery", 120)
  };
}

function templateId(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function sendEmail({ toEmail, toName, subject, htmlContent, textContent, replyTo, tag, template, params }) {
  if (!emailIsValid(toEmail)) throw new Error("Recipient email is invalid");

  const body = {
    sender: sender(),
    to: [{ email: clean(toEmail, 320), name: clean(toName, 120) }],
    subject: clean(subject, 200),
    tags: [clean(tag || "rinko-website", 80)]
  };

  if (replyTo && emailIsValid(replyTo.email)) {
    body.replyTo = { email: clean(replyTo.email, 320), name: clean(replyTo.name, 120) };
  }

  const selectedTemplate = templateId(template);
  if (selectedTemplate) {
    body.templateId = selectedTemplate;
    body.params = params || {};
  } else {
    body.htmlContent = htmlContent;
    body.textContent = textContent;
  }

  return brevoRequest("/smtp/email", body);
}

async function trackEvent(eventName, email, eventProperties) {
  if (String(process.env.BREVO_TRACK_EVENTS || "true").toLowerCase() === "false") return;
  if (!emailIsValid(email)) return;

  try {
    await brevoRequest("/events", {
      event_name: clean(eventName, 255).replace(/[^a-zA-Z0-9_-]/g, "_"),
      event_date: new Date().toISOString(),
      identifiers: { email_id: clean(email, 320) },
      event_properties: eventProperties || {}
    });
  } catch (error) {
    console.error("Brevo event tracking failed:", error.message);
  }
}

function requestIsAllowed(event) {
  const origin = getHeader(event, "origin");
  return !origin || Boolean(getAllowedOrigin(origin));
}

module.exports = {
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
  trackEvent
};
