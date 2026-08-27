// Shared Geoapify helpers. route.js (the map/quote calculator on the
// homepage) has its own inline copy of geocode() with the exact response
// shape the map UI expects — left untouched on purpose. This file exists
// so order.js can independently verify the real driving distance between
// the pickup and drop-off addresses server-side, instead of trusting the
// "distance_miles" number the browser submits (which is a free-typed
// field a customer could set to anything to lower the per-mile fee).

async function geoapifyJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(`Geoapify request failed (${response.status})`);
  return body;
}

async function geocode(address, apiKey) {
  const params = new URLSearchParams({
    text: String(address || "").slice(0, 500),
    format: "json",
    limit: "1",
    filter: "countrycode:us",
    bias: "proximity:-122.2015,47.6101",
    apiKey
  });
  const body = await geoapifyJson(`https://api.geoapify.com/v1/geocode/search?${params}`);
  const match = Array.isArray(body.results) ? body.results[0] : null;
  if (!match || !Number.isFinite(Number(match.lat)) || !Number.isFinite(Number(match.lon))) {
    throw new Error("Address not found");
  }
  return { lat: Number(match.lat), lon: Number(match.lon) };
}

// Returns the real driving distance in miles between two addresses,
// computed entirely server-side. Throws if GEOAPIFY_API_KEY isn't
// configured, an address can't be geocoded, or the routing call fails —
// callers must decide how to handle that (see order.js: it falls back to
// the customer-submitted distance, but flags the order for manual review).
async function routeDistanceMiles(originText, destinationText) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) throw new Error("GEOAPIFY_API_KEY is not configured");

  const [origin, destination] = await Promise.all([
    geocode(originText, apiKey),
    geocode(destinationText, apiKey)
  ]);

  const params = new URLSearchParams({
    waypoints: `${origin.lat},${origin.lon}|${destination.lat},${destination.lon}`,
    mode: "drive",
    format: "geojson",
    apiKey
  });
  const route = await geoapifyJson(`https://api.geoapify.com/v1/routing?${params}`);
  const feature = route && Array.isArray(route.features) ? route.features[0] : null;
  const properties = feature && feature.properties ? feature.properties : {};
  const distanceMeters = Number(properties.distance);

  if (!feature || !Number.isFinite(distanceMeters)) throw new Error("Route not found");

  return Math.round((distanceMeters / 1609.344) * 10) / 10;
}

module.exports = { routeDistanceMiles };
