// RINKO DELIVERY — SAAS CONFIG
// Replace with your Supabase project values.

window.RINKO_SUPABASE_URL = "YOUR_SUPABASE_URL";
window.RINKO_SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

window.rinkoClient = supabase.createClient(
  window.RINKO_SUPABASE_URL,
  window.RINKO_SUPABASE_ANON_KEY
);
