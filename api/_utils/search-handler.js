const fs = require("fs");
const path = require("path");
const { clientIp, handleCorsPreflight, isJsonRequest, originAllowed, publicError, readJson, requestId, safeFetch, setCorsHeaders, sendJson } = require("./http");
const { enforceRateLimit } = require("./rate-limit");
const { writeSearchQueryLog } = require("./search-log");
const { hasSupabaseServerConfig, supabaseHeaders, supabaseServerKey, supabaseUrl } = require("./supabase");

const CLAUDE_SEARCH_MODEL = "claude-sonnet-4-6";
const MAX_QUERY_LENGTH = 700;
const MAX_BODY_BYTES = 5_000;
const MAX_MATCHES = 8;
const FALLBACK_MODES = new Set(["degraded", "strict"]);
let cachedMakers = null;
let cachedPublicProfiles = null;
let cachedPublicProfilesAt = 0;

function loadMakers() {
  if (cachedMakers) return cachedMakers;
  const filePath = path.join(__dirname, "..", "..", "data", "makers.json");
  cachedMakers = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return cachedMakers;
}

async function loadPublicMakerProfiles() {
  const now = Date.now();
  if (cachedPublicProfiles && now - cachedPublicProfilesAt < 60_000) return cachedPublicProfiles;

  const query = new URLSearchParams({
    select: "id,name,country,region,field,capability,tags,summary",
    is_active: "eq.true",
    order: "published_at.desc",
    limit: "100"
  });

  const response = await safeFetch(`${supabaseUrl()}/rest/v1/public_maker_profiles?${query.toString()}`, {
    method: "GET",
    headers: supabaseHeaders(supabaseServerKey())
  }, 8_000);

  if (!response.ok) {
    throw new Error(`Public profile load failed: ${response.status}`);
  }

  const rows = await response.json();
  cachedPublicProfiles = rows.map((row) => ({
    name: row.name,
    country: row.country,
    region: row.region,
    field: row.field,
    capability: row.capability,
    tags: Array.isArray(row.tags) ? row.tags : [],
    summary: row.summary,
    publicProfileId: row.id
  }));
  cachedPublicProfilesAt = now;
  return cachedPublicProfiles;
}

async function loadSearchProfiles() {
  if (process.env.SEARCH_PROFILE_SOURCE === "database" && hasSupabaseServerConfig()) {
    try {
      const profiles = await loadPublicMakerProfiles();
      if (profiles.length > 0) {
        return { makers: profiles, profileSource: "public_maker_profiles" };
      }
    } catch (error) {
      return { makers: loadMakers(), profileSource: "local_fallback" };
    }
  }

  return { makers: loadMakers(), profileSource: "local" };
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasKorean(value) {
  return /[\u3131-\u318e\uac00-\ud7a3]/.test(String(value || ""));
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function relevanceScore(value, defaultScore = 0.82) {
  const score = Number(value);
  if (!Number.isFinite(score)) return defaultScore;
  return Math.max(0, Math.min(1, score));
}

function searchFallbackMode() {
  const mode = String(process.env.SEARCH_FALLBACK_MODE || "degraded").trim().toLowerCase();
  return FALLBACK_MODES.has(mode) ? mode : "degraded";
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

function mergeClaudeMatches(makers, claudeMatches) {
  const makerByName = new Map(makers.map((maker) => [normalize(maker.name), maker]));
  const used = new Set();
  const merged = [];

  (claudeMatches || []).forEach((match) => {
    const maker = makerByName.get(normalize(match.name));
    if (!maker || used.has(maker.name)) return;
    used.add(maker.name);
    merged.push({
      ...maker,
      rankSource: "claude",
      relevance: relevanceScore(match.relevance),
      reason: cleanText(match.reason || "Artihubs matched this maker to the request.", 320),
      reasonKo: cleanText(match.reasonKo, 240),
      suggestedIntro: cleanText(match.suggestedIntro, 260),
      suggestedIntroKo: cleanText(match.suggestedIntroKo, 220)
    });
  });

  return merged.sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name)).slice(0, MAX_MATCHES);
}

function tokenize(value) {
  return normalize(value)
    .split(/[^a-z0-9가-힣]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function fallbackRank({ query, makers }) {
  const queryTokens = tokenize(query);
  const queryText = normalize(query);
  const scored = makers.map((maker) => {
    const makerText = normalize(
      [
        maker.name,
        maker.country,
        maker.region,
        maker.field,
        maker.capability,
        maker.summary,
        ...(maker.tags || [])
      ].join(" ")
    );
    const matches = queryTokens.filter((token) => makerText.includes(token));
    let score = matches.length / Math.max(queryTokens.length, 1);
    if (queryText.includes(normalize(maker.country))) score += 0.2;
    if (queryText.includes(normalize(maker.region))) score += 0.18;
    if (queryText.includes(normalize(maker.field))) score += 0.22;
    if (queryText.includes(normalize(maker.capability))) score += 0.28;
    return {
      ...maker,
      rankSource: "fallback",
      relevance: Math.max(0.1, Math.min(0.92, score)),
      reason:
        matches.length > 0
          ? `Matched prototype profile terms: ${matches.slice(0, 5).join(", ")}.`
          : "Included as a broad prototype profile while AI ranking is unavailable.",
      reasonKo: hasKorean(query) ? "AI 검색이 일시적으로 unavailable 상태라 로컬 프로토타입 랭킹을 사용했습니다." : "",
      suggestedIntro: `Ask ${maker.name} about ${maker.capability}.`,
      suggestedIntroKo: hasKorean(query) ? `${maker.name}에게 ${maker.capability} 관련 가능성을 문의하세요.` : ""
    };
  });

  return scored
    .filter((maker) => maker.relevance >= 0.18)
    .sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name))
    .slice(0, MAX_MATCHES);
}

async function claudeRank({ apiKey, query, makers }) {
  const prompt = {
    query,
    wantsKoreanCompanion: hasKorean(query),
    makers: makers.map((maker) => ({
      name: maker.name,
      country: maker.country,
      region: maker.region,
      field: maker.field,
      capability: maker.capability,
      tags: maker.tags,
      summary: maker.summary
    }))
  };

  const anthropicResponse = await safeFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: CLAUDE_SEARCH_MODEL,
      max_tokens: 1200,
      temperature: 0,
      system:
        "You are Artihubs Engineering Search. Match a user's natural-language need to ONLY the provided maker profiles. English is the canonical product language: summary, reason, and suggestedIntro must always be written in polished, concise English, regardless of the query language. Queries may be written in Korean, English, Japanese, or mixed language; interpret the intent semantically before ranking. When wantsKoreanCompanion is true, also provide concise Korean companion fields that support the English output without replacing it. Do not invent makers, capabilities, countries, or regions. If no provided maker is meaningfully relevant, return an empty matches array. Return strict JSON only.",
      messages: [
        {
          role: "user",
          content:
            "Rank Artihubs Makers for this query. Return JSON with this exact shape: {\"summary\":\"short English search interpretation\",\"summaryKo\":\"optional Korean companion summary, or empty string\",\"matches\":[{\"name\":\"maker name from provided list\",\"relevance\":0.0,\"reason\":\"English reason why this maker matches\",\"reasonKo\":\"optional Korean companion reason, or empty string\",\"suggestedIntro\":\"English intro request angle\",\"suggestedIntroKo\":\"optional Korean companion intro angle, or empty string\"}]}. Use relevance from 0 to 1. Keep at most 8 matches. Keep only meaningfully relevant makers; do not pad the result list. Prioritize high-quality English wording first. If wantsKoreanCompanion is false, use empty strings for Korean companion fields.\n\n" +
            JSON.stringify(prompt)
        }
      ]
    })
  }, 12_000);

  if (!anthropicResponse.ok) {
    throw new Error(`Claude search failed: ${anthropicResponse.status}`);
  }

  const data = await anthropicResponse.json();
  const text = data.content?.find((part) => part.type === "text")?.text || "";
  const parsed = extractJson(text);

  return {
    summary: cleanText(parsed.summary || "Artihubs matched makers for the request.", 340),
    summaryKo: cleanText(parsed.summaryKo, 260),
    matches: mergeClaudeMatches(makers, parsed.matches)
  };
}

function unavailablePayload(profileSource) {
  return {
    mode: "unavailable",
    rankSource: "unavailable",
    degraded: false,
    profileSource,
    summary: "Artihubs search is temporarily unavailable.",
    summaryKo: "",
    matches: []
  };
}

function fallbackPayload({ query, makers, profileSource, summary, summaryKo = "" }) {
  return {
    mode: "fallback",
    rankSource: "fallback",
    degraded: true,
    profileSource,
    summary,
    summaryKo,
    matches: fallbackRank({ query, makers })
  };
}

async function sendFallbackResponse({ response, requestId: id, query, makers, profileSource, startedAt, summary, summaryKo = "" }) {
  const payload = fallbackPayload({ query, makers, profileSource, summary, summaryKo });
  await writeSearchQueryLog({
    query,
    matches: payload.matches,
    rankSource: payload.rankSource,
    degraded: payload.degraded,
    latencyMs: Date.now() - startedAt
  });
  sendJson(response, 200, {
    ok: true,
    ...payload,
    data: payload,
    requestId: id
  });
}

function sendUnavailableResponse({ response, requestId: id, profileSource }) {
  const payload = unavailablePayload(profileSource);
  sendJson(response, 503, {
    ok: false,
    error: publicError("SEARCH_UNAVAILABLE", "Artihubs search is temporarily unavailable."),
    ...payload,
    data: payload,
    requestId: id
  });
}

module.exports = async function handler(request, response) {
  const id = requestId();
  const startedAt = Date.now();
  if (handleCorsPreflight(request, response)) return;

  if (request.method !== "POST") {
    sendJson(response, 405, {
      ok: false,
      error: publicError("METHOD_NOT_ALLOWED", "Method not allowed."),
      requestId: id
    });
    return;
  }

  if (!originAllowed(request)) {
    sendJson(response, 403, {
      ok: false,
      error: publicError("ORIGIN_NOT_ALLOWED", "Request origin is not allowed."),
      requestId: id
    });
    return;
  }
  setCorsHeaders(request, response);

  if (!isJsonRequest(request)) {
    sendJson(response, 415, {
      ok: false,
      error: publicError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json."),
      requestId: id
    });
    return;
  }

  let payload;
  try {
    payload = await readJson(request, MAX_BODY_BYTES);
  } catch (error) {
    const code = error.message === "body_too_large" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON";
    const message = error.message === "body_too_large" ? "Request body is too large." : "Invalid JSON body.";
    sendJson(response, 400, { ok: false, error: publicError(code, message), requestId: id });
    return;
  }

  const query = String(payload.query || "").trim().slice(0, MAX_QUERY_LENGTH);
  let makers;
  let profileSource = "local";
  try {
    const loaded = await loadSearchProfiles();
    makers = loaded.makers;
    profileSource = loaded.profileSource;
  } catch (error) {
    sendJson(response, 503, {
      ok: false,
      error: publicError("MAKER_DATA_UNAVAILABLE", "Maker data is temporarily unavailable."),
      requestId: id
    });
    return;
  }

  const limited = await enforceRateLimit({ key: `search:${clientIp(request)}`, limit: 30, windowMs: 60 * 1000 });
  if (!limited.allowed) {
    sendJson(response, 429, {
      ok: false,
      error: publicError("RATE_LIMITED", "Too many searches. Please try again later."),
      requestId: id
    });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

  if (!query) {
    const emptyPayload = {
      summary: "Enter a natural-language request to search Artihubs.",
      summaryKo: "",
      matches: [],
      rankSource: "idle",
      degraded: false,
      profileSource
    };
    sendJson(response, 200, {
      ok: true,
      ...emptyPayload,
      data: emptyPayload,
      requestId: id
    });
    return;
  }

  const fallbackMode = searchFallbackMode();

  if (!apiKey) {
    if (fallbackMode === "strict") {
      sendUnavailableResponse({ response, requestId: id, profileSource });
      return;
    }

    await sendFallbackResponse({
      response,
      requestId: id,
      query,
      makers,
      profileSource,
      startedAt,
      summary: "AI search is not configured, so Artihubs used local prototype ranking.",
      summaryKo: hasKorean(query) ? "AI 검색 설정이 없어 로컬 프로토타입 랭킹을 사용했습니다." : ""
    });
    return;
  }

  try {
    const ranked = await claudeRank({ apiKey, query, makers });
    const claudePayload = { mode: "claude", rankSource: "claude", degraded: false, profileSource, ...ranked };
    await writeSearchQueryLog({
      query,
      matches: claudePayload.matches,
      rankSource: claudePayload.rankSource,
      model: CLAUDE_SEARCH_MODEL,
      degraded: claudePayload.degraded,
      latencyMs: Date.now() - startedAt
    });
    sendJson(response, 200, { ok: true, ...claudePayload, data: claudePayload, requestId: id });
  } catch (error) {
    if (fallbackMode === "strict") {
      sendUnavailableResponse({ response, requestId: id, profileSource });
      return;
    }

    await sendFallbackResponse({
      response,
      requestId: id,
      query,
      makers,
      profileSource,
      startedAt,
      summary: "AI search is temporarily unavailable, so Artihubs used local prototype ranking.",
      summaryKo: hasKorean(query) ? "AI 검색이 일시적으로 unavailable 상태라 로컬 프로토타입 랭킹을 사용했습니다." : ""
    });
  }
};
