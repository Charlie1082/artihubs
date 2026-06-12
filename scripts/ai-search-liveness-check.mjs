import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(scriptDir, "..", "..");
const defaultRecordDir = path.join(workspaceRoot, "agents", "engineering", "logs", "services", "ai-search-liveness");

const args = process.argv.slice(2);

function argValue(flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

if (args.includes("--help")) {
  console.log(
    [
      "AI search liveness gate (post-deploy).",
      "Asserts production /api/v1/search answers in claude mode, not fallback.",
      "",
      "Usage: node scripts/ai-search-liveness-check.mjs [options]",
      "  --base-url <url>     Target deployment (default: https://artihubs.com)",
      "  --query <text>       Probe query (default: synthetic English probe)",
      "  --record <file>      Record file path (default: agents/engineering/logs/services/ai-search-liveness/<ts>-<status>.json)",
      "  --timeout-ms <n>     Request timeout (default: 20000)",
      "",
      "Exit codes: 0 = live (claude mode), 1 = degraded/unavailable/error (alert path)."
    ].join("\n")
  );
  process.exit(0);
}

const baseUrl = String(argValue("--base-url", "https://artihubs.com")).replace(/\/+$/, "");
const probeQuery = argValue("--query", "waterproof sensor housings for a marine hardware project");
const timeoutMs = Number(argValue("--timeout-ms", "20000")) || 20_000;
const recordOverride = argValue("--record", "");

const startedAt = Date.now();
const checks = [];
const warnings = [];
let responseMeta = null;

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${baseUrl}/api/v1/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: probeQuery }),
    signal: controller.signal
  });
  clearTimeout(timer);

  const body = await response.json().catch(() => null);
  responseMeta = body
    ? {
        statusCode: response.status,
        ok: body.ok === true,
        mode: body.mode,
        rankSource: body.rankSource,
        degraded: body.degraded,
        profileSource: body.profileSource,
        matchCount: Array.isArray(body.matches) ? body.matches.length : null,
        requestId: body.requestId
      }
    : { statusCode: response.status, parseError: true };

  check("http-200", response.status === 200, `status=${response.status}`);
  check("body-ok", body?.ok === true, `ok=${body?.ok}`);
  check("mode-claude", body?.mode === "claude", `mode=${body?.mode}`);
  check("not-fallback", body?.mode !== "fallback" && body?.rankSource !== "fallback", `rankSource=${body?.rankSource}`);
  check("not-degraded", body?.degraded === false, `degraded=${body?.degraded}`);

  if (Array.isArray(body?.matches) && body.matches.length === 0) {
    warnings.push("claude mode returned zero matches for the probe query — verify profile source coverage");
  }
} catch (error) {
  check("request-completed", false, error.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(error.message || error));
}

const passed = checks.length > 0 && checks.every((item) => item.ok);
const finishedAt = new Date();
const record = {
  gate: "ai-search-liveness",
  status: passed ? "live" : "failed",
  baseUrl,
  probeQuery,
  checks,
  warnings,
  response: responseMeta,
  latencyMs: Date.now() - startedAt,
  checkedAt: finishedAt.toISOString()
};

const timestampSlug = finishedAt.toISOString().replace(/[:.]/g, "-");
const recordPath = recordOverride
  ? path.resolve(recordOverride)
  : path.join(defaultRecordDir, `${timestampSlug}-${record.status}.json`);

fs.mkdirSync(path.dirname(recordPath), { recursive: true });
fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
if (!recordOverride) {
  fs.writeFileSync(path.join(defaultRecordDir, "latest.json"), `${JSON.stringify(record, null, 2)}\n`);
}

warnings.forEach((message) => console.log(`WARN ${message}`));
console.log(`${passed ? "LIVE" : "FAILED"} ai-search-liveness — record: ${recordPath}`);
process.exit(passed ? 0 : 1);
