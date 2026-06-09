import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const safeTargets = new Set(["non-production", "nonproduction", "staging", "preview", "development", "test"]);
const productionValues = new Set(["production", "prod", "live"]);

function parseArgs(argv) {
  const options = {
    live: false,
    createUser: false,
    envFile: "",
    output: "",
    origin: process.env.ARTIHUBS_VALIDATION_ORIGIN || "http://127.0.0.1:4173",
    email: process.env.ARTIHUBS_VALIDATION_EMAIL || "",
    password: process.env.ARTIHUBS_VALIDATION_PASSWORD || "",
    displayName: process.env.ARTIHUBS_VALIDATION_DISPLAY_NAME || "Artihubs Nonproduction Test"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") options.live = true;
    else if (arg === "--create-user") options.createUser = true;
    else if (arg === "--env-file") options.envFile = argv[++index] || "";
    else if (arg === "--output") options.output = argv[++index] || "";
    else if (arg === "--origin") options.origin = argv[++index] || options.origin;
    else if (arg === "--email") options.email = argv[++index] || "";
    else if (arg === "--password") options.password = argv[++index] || "";
    else if (arg === "--display-name") options.displayName = argv[++index] || "";
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/auth-nonprod-validation.mjs",
    "  node scripts/auth-nonprod-validation.mjs --live --env-file .env.nonproduction",
    "  node scripts/auth-nonprod-validation.mjs --live --create-user --env-file .env.nonproduction",
    "",
    "Required live safety env:",
    "  NON_PRODUCTION_VALIDATION=true",
    "  ARTIHUBS_SUPABASE_TARGET=non-production",
    "  AUTH_PUBLIC_AUTH_ENABLED=true",
    "",
    "The script never prints raw secrets, bearer tokens, passwords, or raw email addresses."
  ].join("\n");
}

function parseEnvFile(text) {
  const env = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) env[key] = value;
  });
  return env;
}

function loadEnvFile(filePath) {
  if (!filePath) return "";
  const resolved = path.resolve(filePath);
  const env = parseEnvFile(fs.readFileSync(resolved, "utf8"));
  Object.entries(env).forEach(([key, value]) => {
    process.env[key] = value;
  });
  return resolved;
}

function isPlaceholder(value) {
  return !value || /^(replace-|https:\/\/your-project-ref\.supabase\.co)/.test(String(value));
}

function hashValue(value) {
  if (!value) return "";
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  const [name, domain] = normalized.split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 1)}***@${domain}`;
}

function envState() {
  let supabaseHostHash = "";
  try {
    supabaseHostHash = hashValue(new URL(process.env.SUPABASE_URL || "").host);
  } catch (error) {
    supabaseHostHash = "";
  }

  return {
    nonProductionValidation: process.env.NON_PRODUCTION_VALIDATION === "true",
    target: process.env.ARTIHUBS_SUPABASE_TARGET || "",
    vercelEnv: process.env.VERCEL_ENV || "",
    nodeEnv: process.env.NODE_ENV || "",
    authPublicAuthEnabled: process.env.AUTH_PUBLIC_AUTH_ENABLED === "true",
    supabaseUrlConfigured: Boolean(process.env.SUPABASE_URL && !isPlaceholder(process.env.SUPABASE_URL)),
    supabaseHostHash,
    publicKeyConfigured: Boolean(
      (process.env.SUPABASE_ANON_KEY && !isPlaceholder(process.env.SUPABASE_ANON_KEY)) ||
        (process.env.SUPABASE_PUBLISHABLE_KEY && !isPlaceholder(process.env.SUPABASE_PUBLISHABLE_KEY))
    ),
    serverKeyConfigured: Boolean(
      (process.env.SUPABASE_SERVICE_ROLE_KEY && !isPlaceholder(process.env.SUPABASE_SERVICE_ROLE_KEY)) ||
        (process.env.SUPABASE_SECRET_KEY && !isPlaceholder(process.env.SUPABASE_SECRET_KEY))
    )
  };
}

function liveSafetyErrors() {
  const state = envState();
  const errors = [];
  const target = String(state.target).toLowerCase();

  if (!state.nonProductionValidation) {
    errors.push("NON_PRODUCTION_VALIDATION=true is required for live validation.");
  }

  if (!safeTargets.has(target)) {
    errors.push("ARTIHUBS_SUPABASE_TARGET must explicitly identify a non-production target.");
  }

  if (productionValues.has(target) || productionValues.has(String(state.vercelEnv).toLowerCase()) || productionValues.has(String(state.nodeEnv).toLowerCase())) {
    errors.push("Production-like environment markers are blocked.");
  }

  if (!state.authPublicAuthEnabled) {
    errors.push("AUTH_PUBLIC_AUTH_ENABLED=true is required for live public auth validation.");
  }

  if (!state.supabaseUrlConfigured) errors.push("A configured non-placeholder SUPABASE_URL is required.");
  if (!state.publicKeyConfigured) errors.push("A configured Supabase public key is required.");
  if (!state.serverKeyConfigured) errors.push("A configured Supabase server key is required.");

  return { state, errors };
}

function hostFromOrigin(origin) {
  try {
    return new URL(origin).host;
  } catch (error) {
    return "127.0.0.1:4173";
  }
}

async function invokeRaw(handler, rawBody, { method = "POST", url = "/api/test", origin = "http://127.0.0.1:4173", headers = {} } = {}) {
  const request = Readable.from([Buffer.from(rawBody || "")]);
  const host = hostFromOrigin(origin);
  request.method = method;
  request.url = url;
  request.headers = {
    host,
    "x-forwarded-host": host,
    "x-forwarded-for": "127.0.0.1",
    origin,
    ...(["PATCH", "POST"].includes(method) ? { "content-type": "application/json" } : {}),
    ...headers
  };

  return await new Promise((resolve, reject) => {
    const response = {
      statusCode: 0,
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      end(text) {
        try {
          resolve({
            statusCode: this.statusCode,
            headers: this.headers,
            body: text ? JSON.parse(text) : null
          });
        } catch (error) {
          reject(error);
        }
      }
    };

    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function invoke(handler, body, options = {}) {
  return await invokeRaw(handler, JSON.stringify(body || {}), options);
}

async function invokeGet(handler, options = {}) {
  return await invokeRaw(handler, "", { ...options, method: "GET" });
}

function summarizeData(data) {
  if (!data || typeof data !== "object") return null;
  const summary = {};

  if (Object.prototype.hasOwnProperty.call(data, "authenticated")) summary.authenticated = data.authenticated;
  if (Object.prototype.hasOwnProperty.call(data, "authReady")) summary.authReady = data.authReady;
  if (Object.prototype.hasOwnProperty.call(data, "emailVerificationRequired")) summary.emailVerificationRequired = data.emailVerificationRequired;

  if (data.user) {
    summary.user = {
      idPresent: Boolean(data.user.id),
      emailMasked: data.user.email ? maskEmail(data.user.email) : "",
      emailConfirmedAtPresent: Boolean(data.user.emailConfirmedAt)
    };
  }

  if (data.session) {
    summary.session = {
      accessTokenPresent: Boolean(data.session.accessToken),
      refreshTokenExposed: Object.prototype.hasOwnProperty.call(data.session, "refreshToken"),
      expiresInPresent: Boolean(data.session.expiresIn),
      tokenType: data.session.tokenType || ""
    };
  }

  if (data.profile) {
    summary.profile = {
      idPresent: Boolean(data.profile.id),
      displayNamePresent: Boolean(data.profile.displayName)
    };
  }

  if (Array.isArray(data.roles)) summary.roles = data.roles;
  if (Array.isArray(data.permissions)) summary.permissionsCount = data.permissions.length;
  if (Array.isArray(data.memberships)) summary.membershipCount = data.memberships.length;

  return summary;
}

function summarizeResponse(result) {
  return {
    statusCode: result.statusCode,
    ok: result.body?.ok ?? null,
    errorCode: result.body?.error?.code || null,
    requestIdPresent: Boolean(result.body?.requestId),
    requestIdHeaderPresent: Boolean(result.headers?.["X-Request-Id"]),
    data: summarizeData(result.body?.data)
  };
}

async function runCheck(name, expected, task) {
  try {
    const result = await task();
    const summary = summarizeResponse(result);
    const evaluation = expected(summary, result);
    return {
      name,
      ok: evaluation.ok,
      level: evaluation.level || (evaluation.ok ? "pass" : "fail"),
      note: evaluation.note || "",
      result: summary
    };
  } catch (error) {
    return {
      name,
      ok: false,
      level: "fail",
      note: error.message,
      result: null
    };
  }
}

function credentialsReady(options) {
  return Boolean(normalizeEmail(options.email) && String(options.password || "").length >= 8);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const loadedEnvFile = loadEnvFile(options.envFile);
  if (!options.origin) options.origin = process.env.ARTIHUBS_VALIDATION_ORIGIN || "http://127.0.0.1:4173";
  if (!options.email) options.email = process.env.ARTIHUBS_VALIDATION_EMAIL || "";
  if (!options.password) options.password = process.env.ARTIHUBS_VALIDATION_PASSWORD || "";
  if (!options.displayName) options.displayName = process.env.ARTIHUBS_VALIDATION_DISPLAY_NAME || "Artihubs Nonproduction Test";

  const safety = liveSafetyErrors();
  const credentialReady = credentialsReady(options);

  if (!options.live) {
    console.log(JSON.stringify({
      ok: true,
      mode: "dry-run",
      loadedEnvFile: loadedEnvFile ? path.basename(loadedEnvFile) : "",
      liveReady: safety.errors.length === 0,
      credentialReady,
      createUserRequested: options.createUser,
      safety,
      next: "Run with --live only against a disposable non-production Supabase project."
    }, null, 2));
    return;
  }

  if (safety.errors.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      mode: "live",
      loadedEnvFile: loadedEnvFile ? path.basename(loadedEnvFile) : "",
      credentialReady,
      createUserRequested: options.createUser,
      safety
    }, null, 2));
    process.exit(1);
  }

  const authSignup = require("../api/v1/auth/signup.js");
  const authLogin = require("../api/v1/auth/login.js");
  const v1Me = require("../api/v1/me.js");
  const checks = [];

  checks.push(await runCheck(
    "me_missing_token",
    (summary) => ({
      ok: summary.statusCode === 401 && summary.errorCode === "NOT_AUTHENTICATED" && summary.requestIdPresent,
      note: "Confirms configured auth fails closed without bearer token."
    }),
    () => invokeGet(v1Me, { origin: options.origin, url: "/api/v1/me" })
  ));

  if (!credentialReady) {
    checks.push({
      name: "public_auth_credentials",
      ok: false,
      level: "fail",
      note: "Set ARTIHUBS_VALIDATION_EMAIL and ARTIHUBS_VALIDATION_PASSWORD, or pass --email and --password.",
      result: { emailMasked: maskEmail(options.email), passwordPresent: Boolean(options.password) }
    });
  } else {
    const email = normalizeEmail(options.email);
    const password = String(options.password);

    if (options.createUser) {
      checks.push(await runCheck(
        "public_signup_disposable_user",
        (summary) => {
          if (summary.statusCode === 201 && summary.ok === true) {
            return { ok: true, note: "Disposable signup accepted; public profile remains unpublished." };
          }
          if (summary.statusCode === 400 && summary.errorCode === "SIGNUP_FAILED") {
            return { ok: true, level: "warn", note: "Signup returned a public-safe provider-normalized failure, often duplicate disposable email." };
          }
          return { ok: false, note: "Signup did not match accepted non-production validation outcomes." };
        },
        () => invoke(authSignup, {
          displayName: options.displayName,
          email,
          password
        }, { origin: options.origin, url: "/api/v1/auth/signup" })
      ));
    } else {
      checks.push({
        name: "public_signup_disposable_user",
        ok: true,
        level: "skipped",
        note: "Pass --create-user to create a disposable non-production Auth user.",
        result: { emailMasked: maskEmail(email) }
      });
    }

    checks.push(await runCheck(
      "public_login_wrong_password",
      (summary) => ({
        ok: summary.statusCode === 401 && summary.errorCode === "INVALID_CREDENTIALS",
        note: "Confirms wrong-password login is rejected with a public-safe error."
      }),
      () => invoke(authLogin, {
        email,
        password: `${password}x`
      }, { origin: options.origin, url: "/api/v1/auth/login" })
    ));

    const loginCheck = await runCheck(
      "public_login_valid_credentials",
      (summary) => {
        if (summary.statusCode === 200 && summary.data?.session?.accessTokenPresent && !summary.data.session.refreshTokenExposed) {
          return { ok: true, note: "Valid login returned an access token without exposing a refresh token." };
        }
        if (summary.statusCode === 401 && summary.errorCode === "INVALID_CREDENTIALS") {
          return { ok: false, level: "fail", note: "Login rejected. Check email confirmation state, password, or disposable account setup." };
        }
        return { ok: false, note: "Login did not match expected non-production validation outcome." };
      },
      () => invoke(authLogin, {
        email,
        password
      }, { origin: options.origin, url: "/api/v1/auth/login" })
    );
    checks.push(loginCheck);

    const loginToken = loginCheck.result?.data?.session?.accessTokenPresent
      ? await invoke(authLogin, { email, password }, { origin: options.origin, url: "/api/v1/auth/login" })
      : null;
    const accessToken = loginToken?.body?.data?.session?.accessToken || "";

    if (accessToken) {
      checks.push(await runCheck(
        "me_valid_bearer_context",
        (summary) => {
          if (summary.statusCode === 200 && summary.ok === true && summary.data?.authenticated === true) {
            return { ok: true, note: "Account context loaded from Supabase Auth and server-read profile tables." };
          }
          if (summary.statusCode === 503 && ["PROFILE_NOT_FOUND", "PROFILE_LOOKUP_FAILED"].includes(summary.errorCode)) {
            return { ok: false, note: "Auth token is valid, but profile trigger/RLS/context lookup is not validated yet." };
          }
          return { ok: false, note: "Bearer context did not match expected outcomes." };
        },
        () => invokeGet(v1Me, {
          origin: options.origin,
          url: "/api/v1/me",
          headers: { authorization: `Bearer ${accessToken}` }
        })
      ));
    } else {
      checks.push({
        name: "me_valid_bearer_context",
        ok: false,
        level: "fail",
        note: "Skipped because valid login did not provide an access token.",
        result: null
      });
    }
  }

  const failed = checks.filter((check) => check.level !== "warn" && check.level !== "skipped" && !check.ok);
  const payload = {
    ok: failed.length === 0,
    mode: "live",
    loadedEnvFile: loadedEnvFile ? path.basename(loadedEnvFile) : "",
    emailMasked: maskEmail(options.email),
    createUserRequested: options.createUser,
    safety: {
      state: safety.state,
      errors: []
    },
    checks
  };

  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  const rendered = JSON.stringify(payload, null, 2);
  if (failed.length > 0) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

await main();
