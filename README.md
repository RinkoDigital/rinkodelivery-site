# Rinko Delivery website

Static Rinko Delivery website prepared for GitHub and Netlify. Contact and order forms use Netlify Functions to communicate securely with Brevo; the Brevo API key is never exposed to the browser.

Each successful submission creates or updates the submitting email as a Brevo contact, sends the internal transactional notification, and records the matching custom event. When the corresponding Brevo list ID is configured, the contact is also added to that automation list.

## Production structure

- `index.html` — main website and quote form.
- `order.html` — delivery request portal.
- `thank-you.html` — confirmation page.
- `terms.html` and `terms-style.css` — service agreement.
- `assets/` and root image files — website media.
- `netlify/functions/` — contact and order endpoints.
- `netlify/functions/route.js` — private Geoapify route endpoint.
- `netlify/lib/brevo.js` — shared Brevo integration.
- `netlify.toml` — Netlify publishing, functions, and `/api/*` redirects.
- `.env.example` — environment variable names only; it contains no secret.
- `docs/reference/` — preserved legacy notes and form snippets; these files are documentation only and are not used by the live forms.

## Netlify configuration

Connect the repository to Netlify using branch `main`. No build command is required. Use `.` as the publish directory and `netlify/functions` as the functions directory.

Add these environment variables in Netlify:

```text
BREVO_API_KEY=your-private-key
BREVO_SENDER_EMAIL=rinkodanna@gmail.com
BREVO_SENDER_NAME=Rinko Delivery
BREVO_NOTIFY_EMAIL=rinkodanna@gmail.com
BREVO_SEND_AUTOREPLY=false
BREVO_TRACK_EVENTS=true
BREVO_CONTACT_LIST_ID=20
BREVO_ORDER_LIST_ID=your-order-list-id
GEOAPIFY_API_KEY=your-private-geoapify-key
```

Verify `rinkodanna@gmail.com` as a sender in Brevo before testing. Never commit the real API key or a `.env` file.

The quote map uses OpenStreetMap for display and Geoapify for geocoding and route calculation. Create a free Geoapify key without a credit card, store it as `GEOAPIFY_API_KEY` in Netlify, and redeploy. The key remains inside the server-side function and is never exposed to browsers.

## Brevo events

- `contact_form_submitted`
- `order_request_submitted`

Create a Brevo automation for each event. With `BREVO_SEND_AUTOREPLY=false`, customer confirmation should be sent by the corresponding Brevo automation.

## Deployment check

1. Deploy the `main` branch.
2. Submit one contact test and one order test.
3. Confirm the Netlify Functions return success.
4. Confirm both custom events appear in Brevo.
5. Activate the Brevo automations only after the test events are available.

The site no longer requires Google Maps billing or a public Google Maps browser key.

Legacy admin, contractor, and unfinished Supabase pages were intentionally left out of this public package because they contain browser-side access codes or are not production-ready. They are stored in the separate private backup ZIP.
