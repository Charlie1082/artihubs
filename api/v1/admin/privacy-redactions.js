const { authenticateAdmin, handleAdminCorsPreflight, rejectDisallowedAdminOrigin } = require("../../_utils/admin-auth");
const { isJsonRequest, publicError, readJson, requestId, safeFetch, sendJson } = require("../../_utils/http");
const { supabaseHeaders, supabaseServerKey, supabaseUrl } = require("../../_utils/supabase");

const MAX_BODY_BYTES = 2_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rpcUrl(functionName) {
  return new URL(`${supabaseUrl()}/rest/v1/rpc/${functionName}`);
}

function parseCutoff(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > Date.now()) return null;
  return date.toISOString();
}

async function callRpc(functionName, payload) {
  const result = await safeFetch(
    rpcUrl(functionName),
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(supabaseServerKey()),
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    },
    8_000
  );

  if (!result.ok) {
    await result.text();
    const error = new Error("rpc_failed");
    error.code = "PRIVACY_REDACTION_FAILED";
    throw error;
  }

  return await result.json();
}

function scalarRpcValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function redactIntakeSubmission({ payload, response, id, actorProfileId }) {
  const submissionId = String(payload.submissionId || "").trim();
  if (!uuidPattern.test(submissionId)) {
    sendJson(response, 400, {
      ok: false,
      error: publicError("INVALID_SUBMISSION_ID", "A valid submission id is required."),
      requestId: id
    });
    return;
  }

  let result;
  try {
    result = await callRpc("redact_intake_submission", {
      p_submission_id: submissionId,
      p_actor_profile_id: actorProfileId
    });
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: publicError("PRIVACY_REDACTION_FAILED", "Privacy redaction could not be completed."),
      requestId: id
    });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    data: {
      action: "redact_intake_submission",
      submissionId,
      changed: Boolean(scalarRpcValue(result))
    },
    requestId: id
  });
}

async function redactSearchQueryLogs({ payload, response, id }) {
  const before = parseCutoff(payload.before);
  if (!before) {
    sendJson(response, 400, {
      ok: false,
      error: publicError("INVALID_REDACTION_CUTOFF", "A valid past cutoff timestamp is required."),
      requestId: id
    });
    return;
  }

  let result;
  try {
    result = await callRpc("redact_search_query_logs", {
      p_before: before
    });
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: publicError("PRIVACY_REDACTION_FAILED", "Privacy redaction could not be completed."),
      requestId: id
    });
    return;
  }

  const redactedCount = Number(scalarRpcValue(result) || 0);
  sendJson(response, 200, {
    ok: true,
    data: {
      action: "redact_search_query_logs",
      before,
      redactedCount: Number.isFinite(redactedCount) ? redactedCount : 0
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
  if (action === "redact_intake_submission") {
    await redactIntakeSubmission({
      payload,
      response,
      id,
      actorProfileId: authenticated.user.id
    });
    return;
  }

  if (action === "redact_search_query_logs") {
    await redactSearchQueryLogs({ payload, response, id });
    return;
  }

  sendJson(response, 400, {
    ok: false,
    error: publicError("INVALID_REDACTION_ACTION", "Invalid privacy redaction action."),
    requestId: id
  });
};
