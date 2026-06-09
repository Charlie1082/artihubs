function supabaseUrl() {
  return String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
}

function supabaseServerKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
}

function supabasePublicKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
}

function supabaseHeaders(key = supabaseServerKey()) {
  const headers = {
    apikey: key,
    "Content-Type": "application/json"
  };

  // Legacy service_role JWT keys should be sent as Authorization bearer tokens.
  // New sb_secret keys are sent as apikey only.
  if (key && !key.startsWith("sb_")) {
    headers.Authorization = `Bearer ${key}`;
  }

  return headers;
}

function hasSupabaseServerConfig() {
  return Boolean(supabaseUrl() && supabaseServerKey());
}

function hasSupabaseAuthConfig() {
  return Boolean(supabaseUrl() && supabasePublicKey() && supabaseServerKey());
}

module.exports = {
  hasSupabaseAuthConfig,
  hasSupabaseServerConfig,
  supabaseHeaders,
  supabasePublicKey,
  supabaseServerKey,
  supabaseUrl
};
