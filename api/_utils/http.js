const rateLimitBuckets = new Map();

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  if (payload?.requestId) {
    response.setHeader("X-Request-Id", payload.requestId);
  }
  response.end(JSON.stringify(payload));
}

function sendEmpty(response, statusCode) {
  response.statusCode = statusCode;
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.end("");
}

function requestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function publicError(code, message) {
  return { code, message };
}

function clientIp(request) {
  return String(request.headers?.["x-forwarded-for"] || request.headers?.["x-real-ip"] || "unknown")
    .split(",")[0]
    .trim()
    .slice(0, 96);
}

function normalizeOrigin(value) {
  if (!value) return "";
  try {
    return new URL(String(value).trim()).origin;
  } catch (error) {
    return "";
  }
}

function configuredAllowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

function requestHost(request) {
  return String(request.headers?.["x-forwarded-host"] || request.headers?.host || "").split(",")[0].trim().toLowerCase();
}

function originAllowed(request) {
  const rawOrigin = request.headers?.origin;
  if (!rawOrigin) return true;

  const origin = normalizeOrigin(rawOrigin);
  if (!origin) return false;

  const originHost = new URL(origin).host.toLowerCase();
  if (originHost && originHost === requestHost(request)) return true;

  return configuredAllowedOrigins().includes(origin);
}

function allowedCorsOrigin(request) {
  const rawOrigin = request.headers?.origin;
  if (!rawOrigin || !originAllowed(request)) return "";
  return normalizeOrigin(rawOrigin);
}

function setCorsHeaders(request, response) {
  const origin = allowedCorsOrigin(request);
  if (!origin) return false;

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin");
  return true;
}

function handleCorsPreflight(request, response) {
  if (request.method !== "OPTIONS") return false;
  if (!setCorsHeaders(request, response)) {
    sendJson(response, 403, {
      ok: false,
      error: publicError("ORIGIN_NOT_ALLOWED", "Request origin is not allowed."),
      requestId: requestId()
    });
    return true;
  }

  sendEmpty(response, 204);
  return true;
}

function isJsonRequest(request) {
  const contentType = String(request.headers?.["content-type"] || "").toLowerCase();
  return contentType.includes("application/json") || contentType.includes("+json");
}

async function readJson(request, maxBytes = 12_000) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error("body_too_large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  if (rateLimitBuckets.size > 500) {
    for (const [bucketKey, bucket] of rateLimitBuckets.entries()) {
      if (bucket.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
  }

  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt
  };
}

async function safeFetch(url, options = {}, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  clientIp,
  handleCorsPreflight,
  isJsonRequest,
  originAllowed,
  publicError,
  rateLimit,
  readJson,
  requestId,
  safeFetch,
  setCorsHeaders,
  sendEmpty,
  sendJson
};
