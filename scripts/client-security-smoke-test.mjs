import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "api", "data", "deployment", "scripts"]);
const clientExtensions = new Set([".html", ".js", ".css"]);
const serverOnlyTokens = [
  "process.env",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "AUDIT_IP_HASH_SECRET",
  "ADMIN_ALLOWED_ORIGINS",
  "SEARCH_QUERY_HASH_SECRET",
  "SEARCH_QUERY_LOGGING_ENABLED",
  "RATE_LIMIT_MODE",
  "INTAKE_TABLE",
  "SEARCH_PROFILE_SOURCE",
  "ALLOWED_ORIGINS"
];
const legacyApiPaths = ["/api/intake", "/api/search"];

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...walk(path.join(directory, entry.name)));
      }
      continue;
    }

    if (clientExtensions.has(path.extname(entry.name))) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function relative(filePath) {
  return path.relative(projectRoot, filePath);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const clientFiles = walk(projectRoot).sort();
assert(clientFiles.length > 0, "No client files found.");

for (const filePath of clientFiles) {
  const text = fs.readFileSync(filePath, "utf8");
  const rel = relative(filePath);

  for (const token of serverOnlyTokens) {
    assert(!text.includes(token), `${rel} must not reference server-only token ${token}.`);
  }

  for (const apiPath of legacyApiPaths) {
    assert(!text.includes(apiPath), `${rel} must use /api/v1 routes instead of ${apiPath}.`);
  }

  if (path.extname(filePath) === ".html") {
    assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(text), `${rel} must not use inline script tags.`);
    assert(!/\sstyle=["']/i.test(text), `${rel} must not use inline style attributes.`);
  }

  if (path.extname(filePath) === ".html" && text.includes("data-intake-form")) {
    assert(/<script[^>]+src=["'][^"']*site\.js["']/i.test(text), `${rel} has intake forms but does not load site.js.`);
    assert(/<meta[^>]+name=["']turnstile-site-key["']/i.test(text), `${rel} has intake forms but does not define a Turnstile public site-key hook.`);
  }

  if (path.extname(filePath) === ".html" && text.includes('id="ai-search-form"')) {
    assert(/<script[^>]+src=["'][^"']*explore\.js["']/i.test(text), `${rel} has AI search but does not load explore.js.`);
  }
}

const siteJs = fs.readFileSync(path.join(projectRoot, "site.js"), "utf8");
const exploreJs = fs.readFileSync(path.join(projectRoot, "explore", "explore.js"), "utf8");

assert(siteJs.includes('fetch("/api/v1/intake"'), "site.js must submit intake through /api/v1/intake.");
assert(siteJs.includes('meta[name="turnstile-site-key"]'), "site.js must read the Turnstile public site-key meta hook.");
assert(siteJs.includes("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"), "site.js must load Cloudflare Turnstile explicitly when configured.");
assert(siteJs.includes("localPreviewPayload"), "site.js must redact local preview intake payloads before localStorage writes.");
assert(siteJs.includes("existing.push(localPreviewPayload(payload))"), "site.js must not write raw intake payloads to localStorage.");
assert(!siteJs.includes("existing.push(payload)"), "site.js must not push raw intake payloads into localStorage.");
assert(exploreJs.includes('fetch("/api/v1/search"'), "explore.js must search through /api/v1/search.");

console.log(
  JSON.stringify(
    {
      ok: true,
      checkedClientFiles: clientFiles.length,
      routeChecks: {
        intake: "/api/v1/intake",
        search: "/api/v1/search"
      }
    },
    null,
    2
  )
);
