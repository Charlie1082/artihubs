const crypto = require("node:crypto");
const { safeFetch } = require("./http");
const { hasSupabaseServerConfig, supabaseHeaders, supabaseServerKey, supabaseUrl } = require("./supabase");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedRankSources = new Set(["claude", "fallback"]);

function searchLoggingEnabled() {
  return process.env.SEARCH_QUERY_LOGGING_ENABLED === "true";
}

function hashSecret() {
  const secret = String(process.env.SEARCH_QUERY_HASH_SECRET || "");
  return secret.length >= 32 ? secret : "";
}

function normalizeQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function queryHash(query) {
  return crypto.createHmac("sha256", hashSecret()).update(normalizeQuery(query)).digest("hex");
}

function queryPreview(query) {
  return String(query || "")
    .trim()
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .slice(0, 180);
}

function queryLanguage(query) {
  const text = String(query || "");
  if (/[\uac00-\ud7a3]/.test(text)) return "ko";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  return "en";
}

function resultProfileIds(matches) {
  return (matches || [])
    .map((match) => String(match.publicProfileId || "").trim())
    .filter((id) => uuidPattern.test(id))
    .slice(0, 16);
}

async function writeSearchQueryLog({ query, matches, rankSource, model = null, degraded = false, latencyMs = null }) {
  if (!query || !searchLoggingEnabled() || !hashSecret() || !hasSupabaseServerConfig()) {
    return { ok: false, skipped: true };
  }

  if (!allowedRankSources.has(rankSource)) {
    return { ok: false, skipped: true };
  }

  const row = {
    query_preview: queryPreview(query),
    query_hash: queryHash(query),
    query_language: queryLanguage(query),
    result_profile_ids: resultProfileIds(matches),
    model,
    rank_source: rankSource,
    latency_ms: Number.isFinite(latencyMs) ? Math.max(0, Math.trunc(latencyMs)) : null,
    status: degraded ? "degraded" : "ok"
  };

  try {
    const response = await safeFetch(
      `${supabaseUrl()}/rest/v1/search_query_logs`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(supabaseServerKey()),
          Prefer: "return=minimal"
        },
        body: JSON.stringify(row)
      },
      4_000
    );

    return { ok: response.ok, skipped: false };
  } catch (error) {
    return { ok: false, skipped: false };
  }
}

module.exports = {
  writeSearchQueryLog
};
