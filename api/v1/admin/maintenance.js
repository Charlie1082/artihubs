const { authenticateAdmin, handleAdminCorsPreflight, rejectDisallowedAdminOrigin } = require("../../_utils/admin-auth");
const { isJsonRequest, publicError, readJson, requestId, safeFetch, sendJson } = require("../../_utils/http");
const { supabaseHeaders, supabaseServerKey, supabaseUrl } = require("../../_utils/supabase");

const MAX_BODY_BYTES = 1_000;

function parseCutoff(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > Date.now()) return null;
  return date.toISOString();
}

async function cleanupExpiredRateLimitBuckets({ payload, response, id }) {
  const before = parseCutoff(payload.before);
  if (!before) {
    sendJson(response, 400, {
      ok: false,
      error: publicError("INVALID_MAINTENANCE_CUTOFF", "A valid past cutoff timestamp is required."),
      requestId: id
    });
    return;
  }

  let result;
  try {
    const url = new URL(`${supabaseUrl()}/rest/v1/rpc/cleanup_expired_rate_limit_buckets`);
    result = await safeFetch(
      url,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(supabaseServerKey()),
          Accept: "application/json"
        },
        body: JSON.stringify({ p_before: before })
      },
      8_000
    );
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: publicError("MAINTENANCE_ACTION_FAILED", "Maintenance action could not be completed."),
      requestId: id
    });
    return;
  }

  if (!result.ok) {
    await result.text();
    sendJson(response, 502, {
      ok: false,
      error: publicError("MAINTENANCE_ACTION_FAILED", "Maintenance action could not be completed."),
      requestId: id
    });
    return;
  }

  const value = await result.json();
  const deletedCount = Number(Array.isArray(value) ? value[0] : value);

  sendJson(response, 200, {
    ok: true,
    data: {
      action: "cleanup_expired_rate_limit_buckets",
      before,
      deletedCount: Number.isFinite(deletedCount) ? deletedCount : 0
    },
    requestId: id
  });
}

module.exports = async function handler(request, response) {
  const id = requestId();

  if (handleAdminCorsPreflight(request, response, id, ["POST", "OPTIONS"])) return;

  if (request.method !== "POST") {
    sendJson(response, 405, {
      ok: false,
      error: publicError("METHOD_NOT_ALLOWED", "Method not allowed."),
      requestId: id
    });
    return;
  }

  if (rejectDisallowedAdminOrigin(request, response, id)) return;

  const authenticated = await authenticateAdmin(request, response, id, ["admin", "super_admin"]);
  if (!authenticated) return;

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

  const action = String(payload.action || "").trim();
  if (action === "cleanup_expired_rate_limit_buckets") {
    await cleanupExpiredRateLimitBuckets({ payload, response, id });
    return;
  }

  sendJson(response, 400, {
    ok: false,
    error: publicError("INVALID_MAINTENANCE_ACTION", "Invalid maintenance action."),
    requestId: id
  });
};
