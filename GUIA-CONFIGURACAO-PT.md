# Rinko Delivery — Guia de Configuração (Supabase + Stripe + Netlify)

Este guia coloca em funcionamento o que foi adicionado ao site: banco de pedidos real, painel admin com pedidos, portal do entregador e cobrança automática via Stripe. Siga na ordem.

Tempo estimado: 30-45 minutos na primeira vez.

---

## 1. Criar o projeto Supabase (banco de dados)

1. Acesse [supabase.com](https://supabase.com) e crie uma conta grátis (pode usar login com GitHub ou Google).
2. Clique em **New Project**. Escolha um nome (ex: `rinko-delivery`), uma senha forte para o banco (guarde essa senha em local seguro — é diferente das chaves de API) e a região mais próxima de Seattle (ex: `us-west-1` ou `us-west-2`).
3. Aguarde uns 2 minutos até o projeto ficar pronto.
4. No menu lateral, vá em **SQL Editor** → **New query**. Cole todo o conteúdo do arquivo `supabase_schema.sql` (está na raiz deste pacote) e clique em **Run**. Isso cria as tabelas de configurações, cupons, pedidos e perfis (admin/entregador), já com as regras de segurança.
5. Vá em **Settings** (ícone de engrenagem) → **API**. Você vai precisar de três valores:
   - **Project URL** (ex: `https://abcxyz.supabase.co`)
   - **anon public key** (chave pública, começa com `eyJ...`)
   - **service_role key** (chave secreta, também começa com `eyJ...` — **nunca** exponha essa no navegador)

## 2. Conectar o site ao Supabase

1. Abra `assets/rinko-saas-config.js` e substitua:
   ```js
   window.RINKO_SUPABASE_URL = "YOUR_SUPABASE_URL";       // cole o Project URL
   window.RINKO_SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"; // cole a anon public key
   ```
2. A `service_role key` **não** entra em nenhum arquivo `.html` ou `.js` do site — ela vai direto nas variáveis de ambiente do Netlify (passo 6).

## 3. Criar sua conta de administrador

1. No Supabase, vá em **Authentication** → **Users** → **Add user** → **Create new user**. Use seu email real e uma senha forte. Marque "Auto Confirm User".
2. Isso cria automaticamente uma linha em `rinko_profiles` com `role = 'contractor'` (padrão). Você precisa promover essa conta para admin:
   - Vá em **Table Editor** → tabela `rinko_profiles`.
   - Encontre a linha com seu `id` (o mesmo UUID do usuário criado — dá pra conferir em Authentication → Users clicando no seu usuário).
   - Edite a coluna `role` para `admin` e salve.
3. Pronto — esse email/senha agora abre `admin-saas.html`.

## 4. Criar contas dos entregadores (contractors)

Para cada entregador:
1. **Authentication** → **Users** → **Add user**, com o email e uma senha temporária (peça pra ele trocar depois, ou gerencie você mesmo).
2. Não precisa fazer mais nada — o perfil já nasce com `role = 'contractor'`, que é o que `contractors.html` exige.
3. Passe pro entregador: o link `contractors.html` do site, o email e a senha.

## 5. Configurar o Stripe (cobrança automática)

1. Acesse [dashboard.stripe.com](https://dashboard.stripe.com) e crie/entre na conta da Rinko Delivery.
2. **Comece em modo de teste** (o botão no canto superior costuma dizer "Test mode"). Vá em **Developers** → **API keys** e copie a **Secret key** (`sk_test_...`).
3. Ainda em modo de teste, vá em **Developers** → **Webhooks** → **Add endpoint**:
   - URL do endpoint: `https://SEUDOMINIO/api/stripe-webhook` (troque pelo seu domínio real depois do deploy)
   - Eventos a escutar: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
   - Depois de criar, copie o **Signing secret** (`whsec_...`).
4. Guarde os dois valores (`sk_test_...` e `whsec_...`) para o próximo passo.

## 6. Configurar as variáveis de ambiente no Netlify

No painel do Netlify do seu site: **Site configuration** → **Environment variables** → adicione (ou confirme que já existem, no caso do Brevo):

```
BREVO_API_KEY=...
BREVO_SENDER_EMAIL=rinkodanna@gmail.com
BREVO_SENDER_NAME=Rinko Delivery
BREVO_NOTIFY_EMAIL=rinkodanna@gmail.com
BREVO_SEND_AUTOREPLY=false
BREVO_TRACK_EVENTS=true

SUPABASE_URL=https://abcxyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...   (a service_role, não a anon)

STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

SITE_URL=https://SEUDOMINIO
```

Depois de salvar, faça um **novo deploy** (Netlify não aplica variáveis novas em um deploy já existente — em "Deploys", clique em "Trigger deploy" → "Deploy site").

## 7. Testar de ponta a ponta (use o modo de teste do Stripe primeiro!)

1. Abra `order.html` no site publicado, preencha um pedido de teste e envie.
2. Você deve ser redirecionado para uma tela do Stripe. Use o cartão de teste `4242 4242 4242 4242`, qualquer data futura, qualquer CVC.
3. Depois de pagar, você volta para `thank-you.html` com a mensagem "Payment received".
4. Abra `admin-saas.html`, faça login com sua conta admin. O pedido deve aparecer na tabela de **Orders**, com pagamento "paid".
5. Atribua o pedido a um entregador (dropdown na coluna "Contractor").
6. Faça login em `contractors.html` com a conta desse entregador — o pedido deve aparecer, com botão para avançar o status (Assigned → Picked up → Delivered).

Se o pedido não aparecer como "paid": confira em Stripe → Developers → Webhooks → seu endpoint → se o evento foi entregue com sucesso (status 200). Erros ali geralmente são `STRIPE_WEBHOOK_SECRET` errado ou variável não aplicada (esqueceu de fazer redeploy).

## 8. Ir para produção (dinheiro de verdade)

Só faça isso depois de validar tudo em modo de teste:
1. No Stripe, ative a conta para produção (dados bancários, verificação da empresa).
2. Troque para **Live mode**, copie a nova **Secret key** (`sk_live_...`) e crie um **novo webhook** em modo live (o de teste não vale em produção) — copie o novo `whsec_...`.
3. Atualize `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` no Netlify com os valores live, e faça redeploy.

## Opcional: atualização automática dos pedidos (Realtime)

O painel admin e o portal do entregador têm um botão "Refresh" que sempre funciona. Se quiser que a lista atualize sozinha quando um pedido novo chega ou muda de status (sem precisar clicar), ative o Realtime na tabela:

1. No Supabase, vá em **Database** → **Replication**.
2. Encontre `rinko_orders` na lista de tabelas e ative o toggle.

Sem isso, tudo continua funcionando normalmente — só precisa clicar em "Refresh" para ver mudanças feitas por outra pessoa.

## Notas de segurança

- A antiga senha de admin (`Rinkodanna0608`, hardcoded em `admin.html`) foi removida do código. Se você usa essa senha, ou uma parecida, em qualquer outro lugar (email, outro sistema), troque — ela ficou exposta em texto puro no navegador durante um tempo.
- A `service_role key` do Supabase e a `Secret key` do Stripe nunca devem aparecer em nenhum arquivo `.html` ou `.js` que o navegador carrega — só em variáveis de ambiente do Netlify. Se algum dia desconfiar que vazou, gere uma nova em cada painel (Supabase → Settings → API → Reset; Stripe → Developers → API keys → Roll key).
- Nunca commite um arquivo `.env` de verdade no GitHub — o `.gitignore` já está configurado para isso, mas vale conferir antes de cada push.
