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

function tokenize(query) {
  const expanded = normalize(query)
    .replace(/\bparts?\b/g, "part component fixture housing")
    .replace(/\brobot\b/g, "robot robotics automation motion")
    .replace(/\bwater\s*proof\b/g, "waterproof marine sealed housing")
    .replace(/\bai\b/g, "ai software automation workflow")
    .replace(/\brepair\b/g, "repair repairable kit maintenance");

  return [...new Set(expanded.split(/[^a-z0-9]+/).filter((token) => token.length > 1))];
}

function makerText(maker) {
  return normalize([
    maker.name,
    maker.country,
    maker.region,
    maker.field,
    maker.capability,
    maker.summary,
    ...(maker.tags || [])
  ].join(" "));
}

function localRank(makers, query) {
  const tokens = tokenize(query);
  const hasQuery = tokens.length > 0;

  return makers
    .map((maker) => {
      const text = makerText(maker);
      let score = hasQuery ? 0 : 0.35;

      tokens.forEach((token) => {
        if (normalize(maker.name).includes(token)) score += 4;
        if (normalize(maker.capability).includes(token)) score += 3.2;
        if (normalize(maker.field).includes(token)) score += 2.8;
        if (normalize(maker.tags.join(" ")).includes(token)) score += 2.2;
        if (normalize(`${maker.country} ${maker.region}`).includes(token)) score += 1.6;
        if (text.includes(token)) score += 1;
      });

      return {
        ...maker,
        rankSource: "fallback",
        relevance: Math.min(0.99, score / Math.max(4, tokens.length * 2.8)),
        reason: hasQuery
          ? `Matched against capability, region, tags, and profile text for "${query}".`
          : "Shown as a current Artihubs prototype profile."
      };
    })
    .filter((maker) => !hasQuery || maker.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function relevanceScore(value, fallback = 0.82) {
  const score = Number(value);
  if (!Number.isFinite(score)) return fallback;
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

function mergeClaudeMatches(makers, claudeMatches, fallbackMatches) {
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
      reason: String(match.reason || "Claude matched this maker to the request.").slice(0, 260),
      suggestedIntro: String(match.suggestedIntro || "").slice(0, 260)
    });
  });

  if (merged.length > 0) {
    return merged.sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name)).slice(0, 8);
  }

  return fallbackMatches;
}

async function claudeRank({ apiKey, query, makers, fallbackMatches }) {
  const prompt = {
    query,
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
      max_tokens: 900,
      temperature: 0,
      system:
        "You are Artihubs Engineering Search. Match a user's natural-language need to ONLY the provided maker profiles. Do not invent makers, capabilities, countries, or regions. Return strict JSON only.",
      messages: [
        {
          role: "user",
          content:
            "Rank Artihubs Makers for this query. Return JSON with this exact shape: {\"summary\":\"short search interpretation\",\"matches\":[{\"name\":\"maker name from provided list\",\"relevance\":0.0,\"reason\":\"why this maker matches\",\"suggestedIntro\":\"short intro request angle\"}]}. Use relevance from 0 to 1. Keep at most 8 matches.\n\n" +
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
    summary: String(parsed.summary || "Claude ranked makers for the request.").slice(0, 300),
    matches: mergeClaudeMatches(makers, parsed.matches, fallbackMatches)
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
  const fallbackMatches = localRank(makers, query);
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

  if (!query) {
    send(response, 200, {
      ok: true,
      mode: "fallback",
      model: null,
      summary: "Showing current Artihubs prototype makers.",
      matches: fallbackMatches
    });
    return;
  }

  if (!apiKey) {
    send(response, 200, {
      ok: true,
      mode: "fallback",
      model: null,
      summary: query
        ? "Local ranking is active. Add ANTHROPIC_API_KEY in Vercel to enable Claude Sonnet 4.6 search."
        : "Showing current Artihubs prototype makers.",
      matches: fallbackMatches
    });
    return;
  }

  try {
    const ranked = await claudeRank({ apiKey, query, makers, fallbackMatches });
    send(response, 200, { ok: true, ...ranked });
  } catch (error) {
    send(response, 200, {
      ok: true,
      mode: "fallback",
      model: CLAUDE_SEARCH_MODEL,
      summary: "Claude search is temporarily unavailable, so Artihubs used local ranking for this request.",
      matches: fallbackMatches
    });
  }
};
