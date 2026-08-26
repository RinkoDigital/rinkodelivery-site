Rinko Delivery - Site Final

Use this folder for Netlify deploy.
Main files:
- index.html
- order.html
- admin.html
- thank-you.html

Tracking:
- Google Tag Manager ID: GTM-QRBVNFPL
- GA4 event to mark as key event: quote_form_submit

Deploy:
1. Upload this ZIP to Netlify
2. Publish your GTM container
3. Test Analytics Realtime

Current handling prices:
- Small: $5.00
- Medium: $8.00
- Large: $12.00


ORDER WORKFLOW ATIVADO
- order.html envia pedidos via Formspree: https://formspree.io/f/xpqkodow
- pedido também fica salvo no navegador em localStorage: RINKO_LAST_ORDER e RINKO_ORDERS
- thank-you.html mostra resumo do último pedido
- para receber email, confirme o Formspree no painel/entrada do email cadastrado.
- total está SEM mínimo de $18: base + distância + velocidade + heavy - desconto.
