const {
  clean,
  json,
  options,
  parseBody,
  requestIsAllowed
} = require("../lib/brevo");

async function geoapifyJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(`Geoapify request failed (${response.status})`);
  return body;
}

async function geocode(address, apiKey) {
  const params = new URLSearchParams({
    text: address,
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
  return {
    lat: Number(match.lat),
    lon: Number(match.lon),
    formatted: clean(match.formatted || address, 500)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options(event);
  if (event.httpMethod !== "POST") return json(event, 405, { ok: false, error: "Method not allowed" });
  if (!requestIsAllowed(event)) return json(event, 403, { ok: false, error: "Request origin not allowed" });

  const apiKey = clean(process.env.GEOAPIFY_API_KEY, 500);
  if (!apiKey) return json(event, 503, { ok: false, error: "Route service is not configured" });

  const data = parseBody(event);
  if (!data) return json(event, 400, { ok: false, error: "Invalid request body" });

  const originText = clean(data.origin, 500);
  const destinationText = clean(data.destination, 500);
  if (originText.length < 3 || destinationText.length < 3) {
    return json(event, 400, { ok: false, error: "Enter both addresses" });
  }

  try {
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

    if (!feature || !feature.geometry || !Number.isFinite(Number(properties.distance))) {
      throw new Error("Route not found");
    }

    return json(event, 200, {
      ok: true,
      origin,
      destination,
      distanceMeters: Number(properties.distance),
      durationSeconds: Number(properties.time || 0),
      geometry: feature.geometry
    });
  } catch (error) {
    console.error("Route calculation failed:", error.message);
    return json(event, 502, { ok: false, error: "Unable to calculate this route" });
  }
};
