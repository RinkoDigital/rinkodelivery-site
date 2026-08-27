Rinko Delivery - Maps + Calculator Fix

O que foi corrigido:
- index.html: removido conflito de JavaScript que podia quebrar scripts depois da calculadora.
- index.html: calculadora não força mais distância mínima escondida antes do Maps atualizar.
- order.html: adicionada integração Google Maps com autocomplete, mapa, rota, distância real e tempo de direção.
- order.html: distância real atualiza o campo distance_miles e recalcula o total automaticamente.
- order.html: removido conflito de JavaScript no tracking.

Integração atual:
- OpenStreetMap + Leaflet para exibir o mapa.
- Geoapify Geocoding API para localizar os endereços.
- Geoapify Routing API para calcular distância e tempo de direção.
- Variável privada `GEOAPIFY_API_KEY` na Netlify.

A conta gratuita da Geoapify não exige cartão. A chave fica somente na Netlify e nunca é enviada ao navegador.
