const { authenticateAccount } = require("../_utils/auth");
const { publicError, requestId, sendJson } = require("../_utils/http");

function sendAuthRequired(response, id, code, message) {
  response.setHeader("WWW-Authenticate", "Bearer");
  sendJson(response, 401, {
    ok: false,
    error: publicError(code, message),
    data: {
      authenticated: false,
      authReady: true,
      profile: null,
      roles: [],
      permissions: []
    },
    requestId: id
  });
}

module.exports = async function handler(request, response) {
  const id = requestId();

  if (request.method !== "GET") {
    sendJson(response, 405, {
      ok: false,
      error: publicError("METHOD_NOT_ALLOWED", "Method not allowed."),
      requestId: id
    });
    return;
  }

  const authenticated = await authenticateAccount(request);
  if (!authenticated.ok && authenticated.code === "AUTH_NOT_CONFIGURED") {
    sendJson(response, 501, {
      ok: false,
      error: publicError("AUTH_NOT_CONFIGURED", "Artihubs authentication is not configured yet."),
      data: {
        authenticated: false,
        authReady: false,
        profile: null,
        roles: [],
        permissions: []
      },
      requestId: id
    });
    return;
  }

  if (!authenticated.ok && authenticated.code === "NOT_AUTHENTICATED") {
    sendAuthRequired(response, id, "NOT_AUTHENTICATED", "Authentication is required.");
    return;
  }

  if (!authenticated.ok && authenticated.code === "INVALID_AUTH_TOKEN") {
    sendAuthRequired(response, id, "INVALID_AUTH_TOKEN", "Authentication token is invalid.");
    return;
  }

  if (!authenticated.ok && authenticated.code === "AUTH_PROVIDER_UNAVAILABLE") {
    sendJson(response, 503, {
      ok: false,
      error: publicError("AUTH_PROVIDER_UNAVAILABLE", "Authentication provider is unavailable."),
      data: {
        authenticated: false,
        authReady: true,
        profile: null,
        roles: [],
        permissions: []
      },
      requestId: id
    });
    return;
  }

  if (!authenticated.ok && (authenticated.code === "PROFILE_LOOKUP_FAILED" || authenticated.code === "PROFILE_NOT_FOUND")) {
    sendJson(response, 503, {
      ok: false,
      error: publicError(authenticated.code, "Authenticated profile could not be loaded."),
      data: {
        authenticated: true,
        authReady: true,
        user: authenticated.user,
        profile: null,
        roles: [],
        permissions: []
      },
      requestId: id
    });
    return;
  }

  if (!authenticated.ok) {
    sendJson(response, authenticated.status || 503, {
      ok: false,
      error: publicError(authenticated.code || "AUTH_FAILED", "Authentication could not be completed."),
      data: {
        authenticated: false,
        authReady: true,
        profile: null,
        roles: [],
        permissions: []
      },
      requestId: id
    });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    data: {
      authenticated: true,
      authReady: true,
      user: authenticated.user,
      profile: authenticated.account.profile,
      roles: authenticated.account.roles,
      permissions: authenticated.account.permissions,
      memberships: authenticated.account.memberships
    },
    requestId: id
  });
};
