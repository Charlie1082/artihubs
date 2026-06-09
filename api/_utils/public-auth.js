const { clientIp, handleCorsPreflight, isJsonRequest, originAllowed, publicError, readJson, requestId, safeFetch, setCorsHeaders, sendJson } = require("./http");
const { enforceRateLimit } = require("./rate-limit");
const { hasSupabaseAuthConfig, supabasePublicKey, supabaseUrl } = require("./supabase");

const MAX_BODY_BYTES = 4_000;

function publicAuthEnabled() {
  return process.env.AUTH_PUBLIC_AUTH_ENABLED === "true";
}

function hasPublicAuthRuntime() {
  return publicAuthEnabled() && hasSupabaseAuthConfig();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id || null,
    email: user.email || null,
    emailConfirmedAt: user.email_confirmed_at || null,
    createdAt: user.created_at || null
  };
}

function publicSession(data) {
  const session = data?.session || data;
  return {
    accessToken: session?.access_token || "",
    expiresIn: Number(session?.expires_in) || null,
    tokenType: session?.token_type || "bearer"
  };
}

function authHeaders() {
  return {
    apikey: supabasePublicKey(),
    "Content-Type": "application/json"
  };
}

async function preparePublicAuthRequest(request, response, id, { limit = 6 } = {}) {
  if (handleCorsPreflight(request, response)) return { stop: true };

  if (request.method !== "POST") {
    sendJson(response, 405, {
      ok: false,
      error: publicError("METHOD_NOT_ALLOWED", "Method not allowed."),
      requestId: id
    });
    return { stop: true };
  }

  if (!originAllowed(request)) {
    sendJson(response, 403, {
      ok: false,
      error: publicError("ORIGIN_NOT_ALLOWED", "Request origin is not allowed."),
      requestId: id
    });
    return { stop: true };
  }
  setCorsHeaders(request, response);

  if (!hasPublicAuthRuntime()) {
    sendJson(response, 501, {
      ok: false,
      error: publicError("AUTH_NOT_CONFIGURED", "Artihubs public authentication is not enabled for this environment."),
      requestId: id
    });
    return { stop: true };
  }

  if (!isJsonRequest(request)) {
    sendJson(response, 415, {
      ok: false,
      error: publicError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json."),
      requestId: id
    });
    return { stop: true };
  }

  let payload;
  try {
    payload = await readJson(request, MAX_BODY_BYTES);
  } catch (error) {
    const code = error.message === "body_too_large" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON";
    const message = error.message === "body_too_large" ? "Request body is too large." : "Invalid JSON body.";
    sendJson(response, 400, { ok: false, error: publicError(code, message), requestId: id });
    return { stop: true };
  }

  const email = normalizeEmail(payload.email);
  const rateKey = `public-auth:${clientIp(request)}:${email || "no-email"}`;
  const limited = await enforceRateLimit({ key: rateKey, limit, windowMs: 10 * 60 * 1000 });
  if (!limited.allowed) {
    sendJson(response, 429, {
      ok: false,
      error: publicError("RATE_LIMITED", "Too many authentication attempts. Please try again later."),
      requestId: id
    });
    return { stop: true };
  }

  const password = String(payload.password || "");
  if (!isEmail(email)) {
    sendJson(response, 400, { ok: false, error: publicError("INVALID_EMAIL", "A valid email is required."), requestId: id });
    return { stop: true };
  }

  if (password.length < 8 || password.length > 128) {
    sendJson(response, 400, {
      ok: false,
      error: publicError("INVALID_PASSWORD", "Password must be between 8 and 128 characters."),
      requestId: id
    });
    return { stop: true };
  }

  return {
    stop: false,
    payload,
    email,
    password,
    displayName: cleanText(payload.displayName, 120)
  };
}

function supabaseAuthUrl(pathname) {
  return `${supabaseUrl()}/auth/v1/${pathname}`;
}

module.exports = {
  authHeaders,
  preparePublicAuthRequest,
  publicSession,
  publicUser,
  requestId,
  safeFetch,
  sendJson,
  publicError,
  supabaseAuthUrl
};
