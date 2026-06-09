const { authenticateAccount, hasAnyAdminRole } = require("./auth");
const { publicError, sendEmpty, sendJson } = require("./http");

function sendAuthRequired(response, id, code, message) {
  response.setHeader("WWW-Authenticate", "Bearer");
  sendJson(response, 401, {
    ok: false,
    error: publicError(code, message),
    requestId: id
  });
}

async function authenticateAdmin(request, response, id, allowedRoles = ["reviewer", "admin", "super_admin"]) {
  const authenticated = await authenticateAccount(request);

  if (!authenticated.ok && authenticated.code === "AUTH_NOT_CONFIGURED") {
    sendJson(response, 501, {
      ok: false,
      error: publicError("AUTH_NOT_CONFIGURED", "Artihubs authentication is not configured yet."),
      requestId: id
    });
    return null;
  }

  if (!authenticated.ok && authenticated.code === "NOT_AUTHENTICATED") {
    sendAuthRequired(response, id, "NOT_AUTHENTICATED", "Authentication is required.");
    return null;
  }

  if (!authenticated.ok && authenticated.code === "INVALID_AUTH_TOKEN") {
    sendAuthRequired(response, id, "INVALID_AUTH_TOKEN", "Authentication token is invalid.");
    return null;
  }

  if (!authenticated.ok && authenticated.code === "AUTH_PROVIDER_UNAVAILABLE") {
    sendJson(response, 503, {
      ok: false,
      error: publicError("AUTH_PROVIDER_UNAVAILABLE", "Authentication provider is unavailable."),
      requestId: id
    });
    return null;
  }

  if (!authenticated.ok && (authenticated.code === "PROFILE_LOOKUP_FAILED" || authenticated.code === "PROFILE_NOT_FOUND")) {
    sendJson(response, 503, {
      ok: false,
      error: publicError(authenticated.code, "Authenticated profile could not be loaded."),
      requestId: id
    });
    return null;
  }

  if (!authenticated.ok) {
    sendJson(response, authenticated.status || 503, {
      ok: false,
      error: publicError(authenticated.code || "AUTH_FAILED", "Authentication could not be completed."),
      requestId: id
    });
    return null;
  }

  if (!hasAnyAdminRole(authenticated.account, allowedRoles)) {
    sendJson(response, 403, {
      ok: false,
      error: publicError("ADMIN_ROLE_REQUIRED", "Admin role is required."),
      requestId: id
    });
    return null;
  }

  return {
    user: authenticated.user,
    account: authenticated.account
  };
}

function rejectDisallowedAdminOrigin(request, response, id) {
  if (adminOriginAllowed(request)) {
    setAdminCorsHeaders(request, response);
    return false;
  }

  sendJson(response, 403, {
    ok: false,
    error: publicError("ORIGIN_NOT_ALLOWED", "Request origin is not allowed."),
    requestId: id
  });
  return true;
}

function handleAdminCorsPreflight(request, response, id, methods = ["GET", "PATCH", "POST", "OPTIONS"]) {
  if (request.method !== "OPTIONS") return false;

  if (!setAdminCorsHeaders(request, response, methods)) {
    sendJson(response, 403, {
      ok: false,
      error: publicError("ORIGIN_NOT_ALLOWED", "Request origin is not allowed."),
      requestId: id
    });
    return true;
  }

  sendEmpty(response, 204);
  return true;
}

function normalizeOrigin(value) {
  if (!value) return "";
  try {
    return new URL(String(value).trim()).origin;
  } catch (error) {
    return "";
  }
}

function requestHost(request) {
  return String(request.headers?.["x-forwarded-host"] || request.headers?.host || "").split(",")[0].trim().toLowerCase();
}

function adminAllowedOrigins() {
  return String(process.env.ADMIN_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

function adminOriginAllowed(request) {
  const rawOrigin = request.headers?.origin;
  if (!rawOrigin) return true;

  const origin = normalizeOrigin(rawOrigin);
  if (!origin) return false;

  const originHost = new URL(origin).host.toLowerCase();
  if (originHost && originHost === requestHost(request)) return true;

  return adminAllowedOrigins().includes(origin);
}

function adminAllowedCorsOrigin(request) {
  const rawOrigin = request.headers?.origin;
  if (!rawOrigin || !adminOriginAllowed(request)) return "";
  return normalizeOrigin(rawOrigin);
}

function setAdminCorsHeaders(request, response, methods = ["GET", "PATCH", "POST", "OPTIONS"]) {
  const origin = adminAllowedCorsOrigin(request);
  if (!origin) return false;

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", methods.join(", "));
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin");
  return true;
}

module.exports = {
  adminOriginAllowed,
  authenticateAdmin,
  handleAdminCorsPreflight,
  setAdminCorsHeaders,
  rejectDisallowedAdminOrigin
};
