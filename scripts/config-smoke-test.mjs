import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkEnvScript = path.join(projectRoot, "scripts", "check-env.mjs");
const exampleEnv = path.join(projectRoot, ".env.example");
const vercelConfig = path.join(projectRoot, "vercel.json");

function run(args) {
  return spawnSync(process.execPath, [checkEnvScript, ...args], {
    cwd: projectRoot,
    encoding: "utf8"
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const exampleResult = run([exampleEnv]);
assert(exampleResult.status === 0, ".env.example should pass non-strict env validation");

const strictExampleResult = run([exampleEnv, "--strict"]);
assert(strictExampleResult.status === 1, ".env.example should fail strict env validation");
assert(strictExampleResult.stderr.includes("SUPABASE_URL must be configured in strict mode."), "strict validation should reject placeholder Supabase URL");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artihubs-env-check-"));
const badEnv = path.join(tmpDir, "bad.env");

fs.writeFileSync(
  badEnv,
  [
    "SUPABASE_URL=https://your-project-ref.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY=",
    "ANTHROPIC_API_KEY=replace-with-vercel-environment-secret",
    "SEARCH_PROFILE_SOURCE=database",
    "SEARCH_QUERY_LOGGING_ENABLED=true",
    "SEARCH_QUERY_HASH_SECRET=short",
    "AUDIT_IP_HASH_SECRET=short",
    "INTAKE_TABLE=unsafe",
    "RATE_LIMIT_MODE=supabase",
    "ALLOWED_ORIGINS=https://evil.example/path,*",
    "ADMIN_ALLOWED_ORIGINS=https://admin.example/path,*",
    "TURNSTILE_REQUIRED=true",
    "TURNSTILE_SECRET_KEY="
  ].join("\n"),
  "utf8"
);

const badResult = run([badEnv]);
assert(badResult.status === 1, "unsafe env combinations should fail validation");
assert(badResult.stderr.includes("INTAKE_TABLE must be one of"), "env validation should reject unsafe intake table");
assert(badResult.stderr.includes("SEARCH_PROFILE_SOURCE=database requires"), "env validation should reject database search without Supabase config");
assert(badResult.stderr.includes("RATE_LIMIT_MODE=supabase requires a configured Supabase URL and server key"), "env validation should reject durable rate limit without Supabase config");
assert(badResult.stderr.includes("SEARCH_QUERY_LOGGING_ENABLED=true requires a configured Supabase URL and server key"), "env validation should reject search logging without Supabase config");
assert(badResult.stderr.includes("SEARCH_QUERY_HASH_SECRET must be at least 32 characters"), "env validation should reject short search query hash secrets");
assert(badResult.stderr.includes("AUDIT_IP_HASH_SECRET must be at least 32 characters"), "env validation should reject short audit IP hash secrets");
assert(badResult.stderr.includes("TURNSTILE_REQUIRED=true requires"), "env validation should reject required Turnstile without secret");
assert(badResult.stderr.includes("ALLOWED_ORIGINS contains an invalid origin"), "env validation should reject origins with paths");
assert(badResult.stderr.includes("ALLOWED_ORIGINS must not contain wildcards"), "env validation should reject wildcard origins");
assert(badResult.stderr.includes("ADMIN_ALLOWED_ORIGINS contains an invalid origin"), "env validation should reject admin origins with paths");
assert(badResult.stderr.includes("ADMIN_ALLOWED_ORIGINS must not contain wildcards"), "env validation should reject wildcard admin origins");

const parsedVercel = JSON.parse(fs.readFileSync(vercelConfig, "utf8"));
const globalHeaders = parsedVercel.headers?.find((entry) => entry.source === "/(.*)")?.headers || [];
const headerMap = new Map(globalHeaders.map((entry) => [entry.key.toLowerCase(), entry.value]));

[
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "x-permitted-cross-domain-policies",
  "strict-transport-security",
  "content-security-policy"
].forEach((key) => {
  assert(headerMap.has(key), `vercel.json should set ${key}.`);
});

assert(!headerMap.has("x-frame-options"), "vercel.json should rely on CSP frame-ancestors so apex/www framing can work.");
assert(headerMap.get("x-content-type-options") === "nosniff", "vercel.json should disable MIME sniffing");
assert(headerMap.get("content-security-policy")?.includes("frame-src 'self'"), "vercel.json should allow same-origin globe iframe.");
const csp = headerMap.get("content-security-policy") || "";
assert(csp.includes("default-src 'self'"), "CSP should default to self.");
assert(csp.includes("object-src 'none'"), "CSP should block plugins.");
assert(csp.includes("frame-ancestors 'self' https://artihubs.com https://www.artihubs.com"), "CSP should restrict framing to Artihubs origins.");
assert(csp.includes("https://challenges.cloudflare.com"), "CSP should allow Cloudflare Turnstile.");
assert(csp.includes("https://cdn.jsdelivr.net"), "CSP should allow the Living Globe CDN modules.");
assert(!csp.includes("'unsafe-inline'"), "CSP should not allow unsafe inline scripts or styles.");
assert(!csp.includes("*"), "CSP should not contain wildcard sources.");

console.log(
  JSON.stringify(
    {
      ok: true,
      example: "passed",
      strictExample: "failed_as_expected",
      unsafeEnv: "failed_as_expected",
      securityHeaders: "passed"
    },
    null,
    2
  )
);
