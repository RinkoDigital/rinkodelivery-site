const { createClient } = require("@supabase/supabase-js");

let cachedClient = null;

// Server-side only. Uses the SERVICE ROLE key, which bypasses Row Level
// Security entirely — this file must never be imported by anything that
// runs in the browser. It is only required from netlify/functions/*.js,
// which always execute on Netlify's servers.
function getServiceClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  }

  cachedClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return cachedClient;
}

module.exports = { getServiceClient };
