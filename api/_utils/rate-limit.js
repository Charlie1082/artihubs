const { rateLimit, safeFetch } = require("./http");
const { hasSupabaseServerConfig, supabaseHeaders, supabaseServerKey, supabaseUrl } = require("./supabase");

function rateLimitMode() {
  return String(process.env.RATE_LIMIT_MODE || "memory").trim().toLowerCase();
}

function fallbackRateLimit(params) {
  return { ...rateLimit(params), source: "memory" };
}

async function supabaseRateLimit({ key, limit, windowMs }) {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const response = await safeFetch(`${supabaseUrl()}/rest/v1/rpc/consume_rate_limit`, {
    method: "POST",
    headers: supabaseHeaders(supabaseServerKey()),
    body: JSON.stringify({
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds
    })
  }, 4_000);

  if (!response.ok) {
    throw new Error(`Supabase rate limit failed: ${response.status}`);
  }

  const data = await response.json();
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.allowed !== "boolean") {
    throw new Error("Supabase rate limit returned an invalid response.");
  }

  return {
    allowed: row.allowed,
    remaining: Number(row.remaining) || 0,
    resetAt: row.reset_at ? Date.parse(row.reset_at) : Date.now() + windowMs,
    source: "supabase"
  };
}

async function enforceRateLimit(params) {
  if (rateLimitMode() === "supabase" && hasSupabaseServerConfig()) {
    try {
      return await supabaseRateLimit(params);
    } catch (error) {
      return fallbackRateLimit(params);
    }
  }

  return fallbackRateLimit(params);
}

module.exports = {
  enforceRateLimit
};
