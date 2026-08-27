# Brevo automation setup

Rinko Delivery now sends website contact requests and delivery order requests through the Netlify Functions in `netlify/functions/`. The browser never receives the Brevo API key.

## Netlify environment variables

Add these variables in the Netlify project settings for the production context:

- `BREVO_API_KEY` — a Brevo API key with access to transactional email and events.
- `BREVO_SENDER_EMAIL` — a verified Brevo sender. The temporary address is `rinkodanna@gmail.com`.
- `BREVO_SENDER_NAME` — sender name shown to customers.
- `BREVO_NOTIFY_EMAIL` — inbox that receives new contact and order notifications.
- `BREVO_SEND_AUTOREPLY` — keep `false` when Brevo Automations sends the customer confirmation, preventing duplicate emails. Use `true` only if the built-in function reply should be used instead.
- `BREVO_TRACK_EVENTS` — `true` to send `contact_form_submitted` and `order_request_submitted` events to Brevo.

The four template ID variables are optional. If left blank, the functions use the built-in transactional messages. If a template ID is supplied, create the matching template in Brevo and use these parameter names:

- Contact notification: `NAME`, `EMAIL`, `COMPANY`, `SERVICE`, `MESSAGE`
- Contact auto-reply: `NAME`, `SERVICE`
- Order notification: `ORDER_ID`, `NAME`, `EMAIL`, `PICKUP`, `DROPOFF`, `DISTANCE`, `ITEM_SIZE`, `SPEED`, `TOTAL`, `BREAKDOWN`, `INSTRUCTIONS`
- Order auto-reply: `ORDER_ID`, `NAME`, `TOTAL`

## Brevo automations

The functions send these custom events after a notification is accepted:

- `contact_form_submitted`
- `order_request_submitted`

Create automations in Brevo using those events if you want follow-up emails, segmentation, or internal routing. The order event includes `order_id`, `estimated_total`, `distance_miles`, `item_size`, and `delivery_speed`.

## Deployment

The site is a manual-deploy project, but the repository now includes `netlify.toml` so Netlify can deploy the static pages and both functions from GitHub. Configure the environment variables before the first production deploy. Do not commit `.env` or an API key.
