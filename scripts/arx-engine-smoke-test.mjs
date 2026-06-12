import { Readable } from "node:stream";
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SEARCH_PROFILE_SOURCE;
delete process.env.SEARCH_FALLBACK_MODE;
delete process.env.SEARCH_QUERY_LOGGING_ENABLED;

const search = require("../api/v1/search.js");
const originalFetch = globalThis.fetch;

let testCount = 0;
function assert(condition, message) {
  testCount += 1;
  if (!condition) throw new Error(message);
}

async function invoke(body, ip = "127.0.0.1") {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = "POST";
  request.url = "/api/v1/search";
  request.headers = { "x-forwarded-for": ip, "content-type": "application/json" };
  return await new Promise((resolve, reject) => {
    const response = {
      statusCode: 0,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      end(text) {
        try { resolve({ statusCode: this.statusCode, body: text ? JSON.parse(text) : null }); }
        catch (error) { reject(error); }
      }
    };
    Promise.resolve(search(request, response)).catch(reject);
  });
}

function mockClaude(parsedResponse, capture = {}) {
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === "https://api.anthropic.com/v1/messages") {
      capture.requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return { content: [{ type: "text", text: JSON.stringify(parsedResponse) }] };
        }
      };
    }
    throw new Error(`unexpected fetch target: ${url}`);
  };
}

// 1. Evidence grounding: hallucinated makers and unverifiable evidence must be dropped.
process.env.ANTHROPIC_API_KEY = "test_anthropic_key";
const capture1 = {};
mockClaude({
  summary: "Marine waterproof housing need.",
  summaryKo: "",
  analysis: ["Goal: waterproof housing for a marine sensor", "Constraint: small prototype run"],
  analysisKo: [],
  clarifyingQuestion: "",
  clarifyingQuestionKo: "",
  matches: [
    {
      name: "Harbor Microfactory",
      relevance: 0.9,
      reason: "Builds waterproof sensor housings for marine projects.",
      reasonKo: "",
      evidence: ["waterproof sensor housings", "marine"],
      suggestedIntro: "Ask about a small waterproof housing run.",
      suggestedIntroKo: ""
    },
    {
      name: "Phantom Works",
      relevance: 0.95,
      reason: "Invented maker that does not exist.",
      reasonKo: "",
      evidence: ["waterproof"],
      suggestedIntro: "n/a",
      suggestedIntroKo: ""
    },
    {
      name: "Quiet Forge Lab",
      relevance: 0.8,
      reason: "Claims quantum computing capability.",
      reasonKo: "",
      evidence: ["quantum computing"],
      suggestedIntro: "n/a",
      suggestedIntroKo: ""
    }
  ]
}, capture1);

const grounded = await invoke({ query: "waterproof housing for a marine sensor" }, "127.0.0.21");
assert(grounded.statusCode === 200, "claude search should return 200");
assert(grounded.body.mode === "claude", "claude search should report claude mode");
assert(grounded.body.matches.length === 1, "hallucinated maker and unverifiable-evidence match must be dropped");
assert(grounded.body.matches[0].name === "Harbor Microfactory", "verified match should survive");
assert(grounded.body.matches[0].evidence.includes("waterproof sensor housings"), "verified evidence should be returned");
assert(grounded.body.analysis.length === 2, "need analysis bullets should pass through");
assert(Array.isArray(grounded.body.analysisKo), "analysisKo should be an array");
assert(grounded.body.clarifyingQuestion === "", "no clarifying question expected for clear need");
assert(capture1.requestBody.messages[0].content.includes("clarificationProvided"), "prompt should carry clarificationProvided flag");

// 2. Clarifying question passes through on first round.
mockClaude({
  summary: "Need is ambiguous.",
  summaryKo: "",
  analysis: ["Goal: unclear hardware help"],
  analysisKo: [],
  clarifyingQuestion: "Is this for a physical product or a software workflow?",
  clarifyingQuestionKo: "실물 제품인가요, 소프트웨어 워크플로인가요?",
  matches: [
    {
      name: "Quiet Forge Lab",
      relevance: 0.4,
      reason: "Provisional broad match for compact robotics parts.",
      reasonKo: "",
      evidence: ["compact robotics parts"],
      suggestedIntro: "Describe the part you need.",
      suggestedIntroKo: ""
    }
  ]
});

const firstRound = await invoke({ query: "I need help building something" }, "127.0.0.22");
assert(firstRound.body.clarifyingQuestion.length > 0, "ambiguous first round should surface one clarifying question");
assert(firstRound.body.clarifyingQuestionKo.length > 0, "Korean companion question should pass through");
assert(firstRound.body.matches.length === 1, "provisional matches should still return alongside the question");

// 3. One-round max: with clarification provided, no second question is allowed even if the model asks one.
const capture3 = {};
mockClaude({
  summary: "Clarified need.",
  summaryKo: "",
  analysis: ["Goal: compact robotics part for an assistive device"],
  analysisKo: [],
  clarifyingQuestion: "What is your budget?",
  clarifyingQuestionKo: "예산이 어떻게 되나요?",
  matches: [
    {
      name: "Quiet Forge Lab",
      relevance: 0.85,
      reason: "Builds compact robotics parts.",
      reasonKo: "",
      evidence: ["compact robotics parts"],
      suggestedIntro: "Share the assistive device context.",
      suggestedIntroKo: ""
    }
  ]
}, capture3);

const secondRound = await invoke({
  query: "I need help building something",
  clarification: {
    question: "Is this for a physical product or a software workflow?",
    answer: "A physical assistive device part."
  }
}, "127.0.0.23");
assert(secondRound.body.clarifyingQuestion === "", "second round must never ask another clarifying question");
assert(secondRound.body.clarifyingQuestionKo === "", "second round must clear the Korean companion question too");
assert(capture3.requestBody.messages[0].content.includes("A physical assistive device part."), "clarification answer should reach the model");

// 4. Claude failure keeps honest fallback semantics with ARX contract fields present.
globalThis.fetch = async (url) => {
  if (String(url) === "https://api.anthropic.com/v1/messages") {
    return { ok: false, status: 503, async json() { return {}; } };
  }
  throw new Error(`unexpected fetch target: ${url}`);
};
const degraded = await invoke({ query: "방수기능" }, "127.0.0.24");
assert(degraded.statusCode === 200, "degraded fallback should return 200");
assert(degraded.body.mode === "fallback" && degraded.body.degraded === true, "fallback must stay honestly marked degraded");
assert(degraded.body.matches.length >= 1, "Korean compound query should match in degraded mode");
assert(degraded.body.matches[0].name === "Harbor Microfactory", "방수기능 should match the waterproof maker via Korean keywords");
assert(degraded.body.matches[0].reasonKo.includes("일치한 프로필 용어"), "Korean degraded reason should list matched terms");
assert(degraded.body.clarifyingQuestion === "" && Array.isArray(degraded.body.analysis), "fallback payload should carry empty ARX contract fields");

// 5. Anti-Matthew rotation: equal-relevance makers order by daily hash, not alphabet.
globalThis.fetch = originalFetch;
delete process.env.ANTHROPIC_API_KEY;
const repairA = await invoke({ query: "repairable kits" }, "127.0.0.25");
const repairB = await invoke({ query: "repairable kits" }, "127.0.0.26");
const namesA = repairA.body.matches.map((m) => m.name);
const namesB = repairB.body.matches.map((m) => m.name);
assert(namesA.length >= 2, "repair query should match multiple makers");
assert(JSON.stringify(namesA) === JSON.stringify(namesB), "rotation must be deterministic within the same day");

const seed = new Date().toISOString().slice(0, 10);
const equalPair = repairA.body.matches.filter((m) => ["Machi Repair Works", "Northline Repair"].includes(m.name));
if (equalPair.length === 2 && Math.round(equalPair[0].relevance / 0.05) === Math.round(equalPair[1].relevance / 0.05)) {
  const expected = [...equalPair]
    .map((m) => ({ name: m.name, key: crypto.createHash("sha256").update(`${seed}:${m.name.toLowerCase()}`).digest("hex") }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => m.name);
  assert(
    JSON.stringify(equalPair.map((m) => m.name)) === JSON.stringify(expected),
    "equal-relevance makers should order by daily rotation key"
  );
}

console.log(JSON.stringify({ ok: true, assertions: testCount }, null, 2));
