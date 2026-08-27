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
- order.html envia pedidos para a função Netlify /api/order, que usa o Brevo para notificação e confirmação por email.
- pedido também fica salvo no navegador em localStorage: RINKO_LAST_ORDER e RINKO_ORDERS
- thank-you.html mostra resumo do último pedido
- configure BREVO_API_KEY, BREVO_SENDER_EMAIL e BREVO_NOTIFY_EMAIL nas variáveis de ambiente do Netlify.
- enquanto o Gmail for usado: BREVO_SENDER_EMAIL e BREVO_NOTIFY_EMAIL devem ser rinkodanna@gmail.com.
- use BREVO_SEND_AUTOREPLY=false quando a confirmação ao cliente estiver configurada em Brevo Automations.
- total está SEM mínimo de $18: base + distância + velocidade + heavy - desconto.

CONTACT WORKFLOW
- index.html envia pedidos de orçamento para a função Netlify /api/contact, também usando Brevo.
- as funções podem registrar os eventos contact_form_submitted e order_request_submitted no Brevo para automações.
- consulte README_BREVO.md para configurar o sender, a chave e os templates opcionais.
