const fs = require("fs");
const path = require("path");

const CLAUDE_SEARCH_MODEL = "claude-sonnet-4-6";
const MAX_QUERY_LENGTH = 700;

function send(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))).toString(
    "utf8"
  );
  return body ? JSON.parse(body) : {};
}

function loadMakers() {
  const filePath = path.join(__dirname, "..", "data", "makers.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
      reason: cleanText(match.reason || "Claude matched this maker to the request.", 320),
      reasonKo: cleanText(match.reasonKo, 240),
      suggestedIntro: cleanText(match.suggestedIntro, 260),
      suggestedIntroKo: cleanText(match.suggestedIntroKo, 220)
    });
  });

  return merged.sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name)).slice(0, 8);
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

  const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
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
  });

  if (!anthropicResponse.ok) {
    throw new Error(`Claude search failed: ${anthropicResponse.status}`);
  }

  const data = await anthropicResponse.json();
  const text = data.content?.find((part) => part.type === "text")?.text || "";
  const parsed = extractJson(text);

  return {
    mode: "claude",
    model: CLAUDE_SEARCH_MODEL,
    summary: cleanText(parsed.summary || "Claude ranked makers for the request.", 340),
    summaryKo: cleanText(parsed.summaryKo, 260),
    matches: mergeClaudeMatches(makers, parsed.matches)
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    send(response, 405, { error: "Method not allowed." });
    return;
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    send(response, 400, { error: "Invalid JSON body." });
    return;
  }

  const query = String(payload.query || "").trim().slice(0, MAX_QUERY_LENGTH);
  const makers = loadMakers();
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

  if (!query) {
    send(response, 200, {
      ok: true,
      mode: "claude",
      model: CLAUDE_SEARCH_MODEL,
      summary: "Enter a natural-language request to test Claude Sonnet 4.6 maker search.",
      matches: []
    });
    return;
  }

  if (!apiKey) {
    send(response, 503, {
      ok: false,
      mode: "claude",
      model: CLAUDE_SEARCH_MODEL,
      error: "Claude Sonnet 4.6 search is not configured. Add ANTHROPIC_API_KEY in Vercel."
    });
    return;
  }

  try {
    const ranked = await claudeRank({ apiKey, query, makers });
    send(response, 200, { ok: true, ...ranked });
  } catch (error) {
    send(response, 502, {
      ok: false,
      mode: "claude",
      model: CLAUDE_SEARCH_MODEL,
      error: "Claude Sonnet 4.6 search failed. No local fallback was used."
    });
  }
};
