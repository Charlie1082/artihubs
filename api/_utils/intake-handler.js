const allowedTypes = new Set(["maker", "seeker", "intro", "general"]);
const MAX_BODY_BYTES = 12_000;
const MAX_FIELD_LENGTHS = {
  name: 120,
  country: 80,
  region: 100,
  field: 160,
  message: 1200,
  sourcePath: 160
};
const {
  clientIp,
  handleCorsPreflight,
  isJsonRequest,
  originAllowed,
  publicError,
  readJson,
  requestId,
  safeFetch,
  setCorsHeaders,
  sendJson
} = require("./http");
const { intakeTableName } = require("./intake-table");
const { enforceRateLimit } = require("./rate-limit");
const { supabaseHeaders, supabaseServerKey, supabaseUrl } = require("./supabase");

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanField(payload, key) {
  return String(payload[key] || "").trim().slice(0, MAX_FIELD_LENGTHS[key]);
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const allowed = {};
  ["userAgent", "submittedAt"].forEach((key) => {
    if (typeof metadata[key] === "string") allowed[key] = metadata[key].slice(0, 240);
  });
  return allowed;
}

async function verifyTurnstile({ token, request }) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const required = process.env.TURNSTILE_REQUIRED === "true";
  if (!secret) return !required;
  if (!token) return !required;

  const formData = new URLSearchParams();
  formData.set("secret", secret);
  formData.set("response", token);
  formData.set("remoteip", clientIp(request));

  const response = await safeFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString()
  }, 5_000);
  const data = await response.json().catch(() => ({}));
  return Boolean(data.success);
}

module.exports = async function handler(request, response) {
  const id = requestId();
  if (handleCorsPreflight(request, response)) return;

  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: publicError("METHOD_NOT_ALLOWED", "Method not allowed."), requestId: id });
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

  const type = allowedTypes.has(payload.type) ? payload.type : "general";
  const email = String(payload.email || "").trim().toLowerCase();
  const rateKey = `intake:${clientIp(request)}:${email || "no-email"}`;
  const limited = await enforceRateLimit({ key: rateKey, limit: 8, windowMs: 10 * 60 * 1000 });

  if (!limited.allowed) {
    sendJson(response, 429, {
      ok: false,
      error: publicError("RATE_LIMITED", "Too many requests. Please try again later."),
      requestId: id
    });
    return;
  }

  if (!isEmail(email)) {
    sendJson(response, 400, { ok: false, error: publicError("INVALID_EMAIL", "A valid email is required."), requestId: id });
    return;
  }

  let turnstileOk = false;
  try {
    turnstileOk = await verifyTurnstile({ token: payload.turnstileToken, request });
  } catch (error) {
    turnstileOk = false;
  }
  if (!turnstileOk) {
    sendJson(response, 403, {
      ok: false,
      error: publicError("BOT_CHECK_FAILED", "Bot verification failed."),
      requestId: id
    });
    return;
  }

  const databaseUrl = supabaseUrl();
  const supabaseServiceRoleKey = supabaseServerKey();
  let tableName;

  try {
    tableName = intakeTableName();
  } catch (error) {
    sendJson(response, 503, {
      ok: false,
      error: publicError("INTAKE_NOT_CONFIGURED", "Artihubs intake is not configured yet."),
      requestId: id
    });
    return;
  }

  if (!databaseUrl || !supabaseServiceRoleKey) {
    sendJson(response, 503, {
      ok: false,
      error: publicError("INTAKE_NOT_CONFIGURED", "Artihubs intake is not configured yet."),
      requestId: id
    });
    return;
  }

  const row = {
    type,
    name: cleanField(payload, "name") || null,
    email,
    country: cleanField(payload, "country") || null,
    region: cleanField(payload, "region") || null,
    field: cleanField(payload, "field") || null,
    message: cleanField(payload, "message") || null,
    source_path: cleanField(payload, "sourcePath") || null,
    metadata: sanitizeMetadata(payload.metadata)
  };

  const headers = { ...supabaseHeaders(supabaseServiceRoleKey), Prefer: "return=representation" };

  let insertResponse;
  try {
    insertResponse = await safeFetch(`${databaseUrl}/rest/v1/${tableName}`, {
      method: "POST",
      headers,
      body: JSON.stringify(row)
    }, 8_000);
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: publicError("INTAKE_INSERT_FAILED", "Request could not be processed."),
      requestId: id
    });
    return;
  }

  if (!insertResponse.ok) {
    await insertResponse.text();
    sendJson(response, 502, {
      ok: false,
      error: publicError("INTAKE_INSERT_FAILED", "Request could not be processed."),
      requestId: id
    });
    return;
  }

  const data = await insertResponse.json();
  const intake = data[0] || null;
  sendJson(response, 201, {
    ok: true,
    data: { id: intake?.id || null, status: intake?.status || "received" },
    requestId: id
  });
};
