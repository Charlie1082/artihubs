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
  const prepared = await preparePublicAuthRequest(request, response, id, { limit: 4 });
  if (prepared.stop) return;

  let signupResponse;
  try {
    signupResponse = await safeFetch(
      supabaseAuthUrl("signup"),
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          email: prepared.email,
          password: prepared.password,
          data: {
            display_name: prepared.displayName || prepared.email.split("@")[0]
          }
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

  const data = await signupResponse.json().catch(() => ({}));
  if (!signupResponse.ok) {
    sendJson(response, signupResponse.status === 422 ? 400 : 502, {
      ok: false,
      error: publicError("SIGNUP_FAILED", "Signup could not be completed."),
      requestId: id
    });
    return;
  }

  const session = publicSession(data);
  sendJson(response, 201, {
    ok: true,
    data: {
      user: publicUser(data.user),
      session: session.accessToken ? session : null,
      emailVerificationRequired: !session.accessToken
    },
    requestId: id
  });
};
