// RINKO DELIVERY — SAAS CONFIG
// Used by admin-saas.html and contractors.html.
// Get both values from Supabase -> Settings -> API -> Project API keys.
// The ANON key is meant to be public (it's what every visitor's browser
// uses) — real security comes from the Row Level Security policies in
// supabase_schema.sql, not from hiding this key. Never put the different
// "service_role" key here — that one stays server-side only (see .env.example).

window.RINKO_SUPABASE_URL = "https://zngvbczkvqcdcjjkoukr.supabase.co";
window.RINKO_SUPABASE_ANON_KEY = "sb_publishable_bIKIHK4heKlIqW6D03rqdg_HAc1ToVE";

window.rinkoClient = supabase.createClient(
  window.RINKO_SUPABASE_URL,
  window.RINKO_SUPABASE_ANON_KEY
);
