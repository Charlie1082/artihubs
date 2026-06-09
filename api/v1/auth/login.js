const {
  authHeaders,
  preparePublicAuthRequest,
  publicError,
  publicSession,
  publicUser,
  requestId,
  safeFetch,
  sendJson,
  supabaseAuthUrl
} = require("../../_utils/public-auth");

module.exports = async function handler(request, response) {
  const id = requestId();
  const prepared = await preparePublicAuthRequest(request, response, id, { limit: 8 });
  if (prepared.stop) return;

  let loginResponse;
  try {
    loginResponse = await safeFetch(
      `${supabaseAuthUrl("token")}?grant_type=password`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          email: prepared.email,
          password: prepared.password
        })
      },
      8_000
    );
  } catch (error) {
    sendJson(response, 503, {
      ok: false,
      error: publicError("AUTH_PROVIDER_UNAVAILABLE", "Authentication provider is unavailable."),
      requestId: id
    });
    return;
  }

  const data = await loginResponse.json().catch(() => ({}));
  if (loginResponse.status === 400 || loginResponse.status === 401) {
    sendJson(response, 401, {
      ok: false,
      error: publicError("INVALID_CREDENTIALS", "Email or password is incorrect, or email verification is still pending."),
      requestId: id
    });
    return;
  }

  if (!loginResponse.ok) {
    sendJson(response, 502, {
      ok: false,
      error: publicError("LOGIN_FAILED", "Login could not be completed."),
      requestId: id
    });
    return;
  }

  const session = publicSession(data);
  if (!session.accessToken) {
    sendJson(response, 401, {
      ok: false,
      error: publicError("SESSION_NOT_ISSUED", "Authentication completed without a usable session."),
      requestId: id
    });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    data: {
      user: publicUser(data.user),
      session
    },
    requestId: id
  });
};
