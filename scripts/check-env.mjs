import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultEnvFile = path.join(projectRoot, ".env.example");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const envFileArg = args.find((arg) => !arg.startsWith("--"));
const envFile = envFileArg ? path.resolve(envFileArg) : defaultEnvFile;

const allowed = {
  INTAKE_TABLE: new Set(["public_intake", "intake_submissions"]),
  RATE_LIMIT_MODE: new Set(["memory", "supabase"]),
  SEARCH_FALLBACK_MODE: new Set(["degraded", "strict"]),
  SEARCH_PROFILE_SOURCE: new Set(["local", "database"]),
  SEARCH_QUERY_LOGGING_ENABLED: new Set(["true", "false"]),
  SEARCH_QUERY_PREVIEW_ENABLED: new Set(["true", "false"]),
  TURNSTILE_REQUIRED: new Set(["true", "false"]),
  AUTH_PUBLIC_AUTH_ENABLED: new Set(["true", "false"])
};

function parseEnv(text) {
  const result = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    result[key] = value;
  });
  return result;
}

function isPlaceholder(value) {
  return !value || /^(replace-|https:\/\/your-project-ref\.supabase\.co)/.test(value);
}

function hasConfiguredSupabaseUrl(env) {
  return Boolean(env.SUPABASE_URL && !isPlaceholder(env.SUPABASE_URL));
}

function hasConfiguredSupabaseServerKey(env) {
  return Boolean(
    (env.SUPABASE_SERVICE_ROLE_KEY && !isPlaceholder(env.SUPABASE_SERVICE_ROLE_KEY)) ||
      (env.SUPABASE_SECRET_KEY && !isPlaceholder(env.SUPABASE_SECRET_KEY))
  );
}

function hasConfiguredSupabaseServer(env) {
  return hasConfiguredSupabaseUrl(env) && hasConfiguredSupabaseServerKey(env);
}

function normalizeOrigin(value) {
  if (!value) return "";
  try {
    return new URL(String(value).trim()).origin;
  } catch (error) {
    return "";
  }
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

const env = parseEnv(fs.readFileSync(envFile, "utf8"));
const errors = [];
const warnings = [];

["SUPABASE_URL", "ANTHROPIC_API_KEY", "SEARCH_FALLBACK_MODE", "SEARCH_PROFILE_SOURCE", "SEARCH_QUERY_LOGGING_ENABLED", "INTAKE_TABLE", "RATE_LIMIT_MODE", "TURNSTILE_REQUIRED", "AUTH_PUBLIC_AUTH_ENABLED"].forEach((key) => {
  assert(Object.prototype.hasOwnProperty.call(env, key), `${key} is missing.`, errors);
});

if (!env.SUPABASE_ANON_KEY && !env.SUPABASE_PUBLISHABLE_KEY) {
  errors.push("Set either SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY.");
}

if (!env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_SECRET_KEY) {
  errors.push("Set either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.");
}

for (const [key, values] of Object.entries(allowed)) {
  if (env[key]) {
    assert(values.has(env[key]), `${key} must be one of: ${Array.from(values).join(", ")}.`, errors);
  }
}

if (env.SUPABASE_URL && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(env.SUPABASE_URL) && !isPlaceholder(env.SUPABASE_URL)) {
  errors.push("SUPABASE_URL must be a base project URL like https://PROJECT_REF.supabase.co.");
}

if (env.ALLOWED_ORIGINS) {
  env.ALLOWED_ORIGINS.split(",").forEach((origin) => {
    const value = origin.trim();
    const normalized = normalizeOrigin(value);
    if (!normalized || value.replace(/\/$/, "") !== normalized) {
      errors.push(`ALLOWED_ORIGINS contains an invalid origin: ${value}`);
    }
    if (value.includes("*")) {
      errors.push("ALLOWED_ORIGINS must not contain wildcards.");
    }
  });
}

if (env.ADMIN_ALLOWED_ORIGINS) {
  env.ADMIN_ALLOWED_ORIGINS.split(",").forEach((origin) => {
    const value = origin.trim();
    const normalized = normalizeOrigin(value);
    if (!normalized || value.replace(/\/$/, "") !== normalized) {
      errors.push(`ADMIN_ALLOWED_ORIGINS contains an invalid origin: ${value}`);
    }
    if (value.includes("*")) {
      errors.push("ADMIN_ALLOWED_ORIGINS must not contain wildcards.");
    }
  });
}

if (strict) {
  ["SUPABASE_URL", "ANTHROPIC_API_KEY"].forEach((key) => {
    if (isPlaceholder(env[key])) errors.push(`${key} must be configured in strict mode.`);
  });

  if (isPlaceholder(env.SUPABASE_SERVICE_ROLE_KEY) && isPlaceholder(env.SUPABASE_SECRET_KEY)) {
    errors.push("A real Supabase server key must be configured in strict mode.");
  }

  if (isPlaceholder(env.SUPABASE_ANON_KEY) && isPlaceholder(env.SUPABASE_PUBLISHABLE_KEY)) {
    errors.push("A real Supabase public key must be configured in strict mode.");
  }
}

if (env.SEARCH_PROFILE_SOURCE === "database" && !hasConfiguredSupabaseServer(env)) {
  errors.push("SEARCH_PROFILE_SOURCE=database requires a configured Supabase URL and server key.");
}

if (env.INTAKE_TABLE === "intake_submissions") {
  warnings.push("INTAKE_TABLE=intake_submissions requires reviewed v1 migrations before production use.");
}

if (env.RATE_LIMIT_MODE === "supabase") {
  if (!hasConfiguredSupabaseServer(env)) {
    errors.push("RATE_LIMIT_MODE=supabase requires a configured Supabase URL and server key.");
  }
  warnings.push("RATE_LIMIT_MODE=supabase requires migration 008_rate_limit_buckets.sql to pass non-production validation.");
}

if (env.SEARCH_QUERY_LOGGING_ENABLED === "true" && isPlaceholder(env.SEARCH_QUERY_HASH_SECRET)) {
  errors.push("SEARCH_QUERY_LOGGING_ENABLED=true requires SEARCH_QUERY_HASH_SECRET.");
}

if (env.SEARCH_QUERY_LOGGING_ENABLED === "true" && !hasConfiguredSupabaseServer(env)) {
  errors.push("SEARCH_QUERY_LOGGING_ENABLED=true requires a configured Supabase URL and server key.");
}

if (env.AUTH_PUBLIC_AUTH_ENABLED === "true" && !hasConfiguredSupabaseServer(env)) {
  errors.push("AUTH_PUBLIC_AUTH_ENABLED=true requires configured Supabase URL and server key.");
}

if (env.AUTH_PUBLIC_AUTH_ENABLED === "true" && !env.SUPABASE_ANON_KEY && !env.SUPABASE_PUBLISHABLE_KEY) {
  errors.push("AUTH_PUBLIC_AUTH_ENABLED=true requires a configured Supabase public key.");
}

if (env.SEARCH_QUERY_LOGGING_ENABLED === "true" && env.SEARCH_QUERY_HASH_SECRET && env.SEARCH_QUERY_HASH_SECRET.length < 32) {
  errors.push("SEARCH_QUERY_HASH_SECRET must be at least 32 characters.");
}

if (env.AUDIT_IP_HASH_SECRET && !isPlaceholder(env.AUDIT_IP_HASH_SECRET) && env.AUDIT_IP_HASH_SECRET.length < 32) {
  errors.push("AUDIT_IP_HASH_SECRET must be at least 32 characters when set.");
}

if (strict && env.AUDIT_IP_HASH_SECRET && isPlaceholder(env.AUDIT_IP_HASH_SECRET)) {
  errors.push("AUDIT_IP_HASH_SECRET must be a real secret when set in strict mode.");
}

if (env.TURNSTILE_REQUIRED === "true" && isPlaceholder(env.TURNSTILE_SECRET_KEY)) {
  errors.push("TURNSTILE_REQUIRED=true requires TURNSTILE_SECRET_KEY.");
}

if (env.TURNSTILE_REQUIRED === "true" && isPlaceholder(env.TURNSTILE_SITE_KEY)) {
  warnings.push("TURNSTILE_REQUIRED=true also requires the public Turnstile site key meta tag on form pages.");
}

if (env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_SECRET_KEY) {
  warnings.push("Both SUPABASE_SERVICE_ROLE_KEY and SUPABASE_SECRET_KEY are set; the service role key takes precedence.");
}

if (errors.length > 0) {
  console.error(JSON.stringify({ ok: false, envFile, strict, errors, warnings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, envFile, strict, warnings }, null, 2));
