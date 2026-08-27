Rinko Delivery - Maps + Calculator Fix

O que foi corrigido:
- index.html: removido conflito de JavaScript que podia quebrar scripts depois da calculadora.
- index.html: calculadora não força mais distância mínima escondida antes do Maps atualizar.
- order.html: adicionada integração Google Maps com autocomplete, mapa, rota, distância real e tempo de direção.
- order.html: distância real atualiza o campo distance_miles e recalcula o total automaticamente.
- order.html: removido conflito de JavaScript no tracking.

Google Cloud necessário:
- Maps JavaScript API
- Places API
- Directions API
- Billing ativo

A chave atual foi mantida como estava no seu arquivo. Se a rota não calcular, confira restrição de domínio/referrer no Google Cloud.
