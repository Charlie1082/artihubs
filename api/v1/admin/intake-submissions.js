const { authenticateAdmin, handleAdminCorsPreflight, rejectDisallowedAdminOrigin } = require("../../_utils/admin-auth");
const { writeAuditEvent } = require("../../_utils/audit");
const { intakeTableName } = require("../../_utils/intake-table");
const { isJsonRequest, publicError, readJson, requestId, safeFetch, sendJson } = require("../../_utils/http");
const { supabaseHeaders, supabaseServerKey, supabaseUrl } = require("../../_utils/supabase");

const publicIntakeStatuses = new Set(["new", "reviewing", "contacted", "archived"]);
const v1IntakeStatuses = new Set(["new", "reviewing", "converted", "contacted", "archived"]);
const allowedTypes = new Set(["maker", "seeker", "intro", "general"]);
const MAX_PATCH_BODY_BYTES = 2_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function currentUrl(request) {
  return new URL(request.url || "/api/v1/admin/intake-submissions", "https://artihubs.local");
}

function listLimit(url) {
  const raw = Number(url.searchParams.get("limit") || 25);
  if (!Number.isFinite(raw)) return 25;
  return Math.min(50, Math.max(1, Math.trunc(raw)));
}

function tableSelect(table) {
  const base = ["id", "type", "name", "email", "country", "region", "field", "message", "source_path", "status", "created_at"];
  if (table === "intake_submissions") {
    base.push("converted_entity_type", "converted_entity_id", "reviewed_by", "reviewed_at");
  }
  return base.join(",");
}

function normalizeSubmission(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name || null,
    email: row.email,
    country: row.country || null,
    region: row.region || null,
    field: row.field || null,
    message: row.message || null,
    sourcePath: row.source_path || null,
    status: row.status,
    convertedEntityType: row.converted_entity_type || null,
    convertedEntityId: row.converted_entity_id || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at
  };
}

function statusesForTable(table) {
  return table === "intake_submissions" ? v1IntakeStatuses : publicIntakeStatuses;
}

function queryUrl(table, request) {
  const inputUrl = currentUrl(request);
  const url = new URL(`${supabaseUrl()}/rest/v1/${table}`);
  url.searchParams.set("select", tableSelect(table));
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(listLimit(inputUrl)));

  const status = inputUrl.searchParams.get("status");
  if (status) {
    if (!statusesForTable(table).has(status)) {
      const error = new Error("invalid_status");
      error.code = "INVALID_STATUS";
      throw error;
    }
    url.searchParams.set("status", `eq.${status}`);
  }

  const type = inputUrl.searchParams.get("type");
  if (type) {
    if (!allowedTypes.has(type)) {
      const error = new Error("invalid_type");
      error.code = "INVALID_TYPE";
      throw error;
    }
    url.searchParams.set("type", `eq.${type}`);
  }

  return url;
}

async function listSubmissions({ table, request, response, id }) {
  const url = queryUrl(table, request);
  let result;
  try {
    result = await safeFetch(
      url,
      {
        headers: {
          ...supabaseHeaders(supabaseServerKey()),
          Accept: "application/json"
        }
      },
      8_000
    );
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: publicError("ADMIN_INTAKE_QUERY_FAILED", "Admin intake submissions could not be loaded."),
      requestId: id
    });
    return;
  }

  if (!result.ok) {
    await result.text();
    sendJson(response, 502, {
      ok: false,
      error: publicError("ADMIN_INTAKE_QUERY_FAILED", "Admin intake submissions could not be loaded."),
      requestId: id
    });
    return;
  }

  const rows = await result.json();
  const submissions = Array.isArray(rows) ? rows.map(normalizeSubmission) : [];

  sendJson(response, 200, {
    ok: true,
    data: {
      table,
      count: submissions.length,
      submissions
    },
    requestId: id
  });
}

function updateUrl(table, submissionId) {
  const url = new URL(`${supabaseUrl()}/rest/v1/${table}`);
  url.searchParams.set("id", `eq.${submissionId}`);
  url.searchParams.set("select", tableSelect(table));
  return url;
}

async function updateSubmission({ table, request, response, id, userId }) {
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
    payload = await readJson(request, MAX_PATCH_BODY_BYTES);
  } catch (error) {
    const code = error.message === "body_too_large" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON";
    const message = error.message === "body_too_large" ? "Request body is too large." : "Invalid JSON body.";
    sendJson(response, 400, { ok: false, error: publicError(code, message), requestId: id });
    return;
  }

  const submissionId = String(payload.id || "").trim();
  const status = String(payload.status || "").trim();

  if (!uuidPattern.test(submissionId)) {
    sendJson(response, 400, {
      ok: false,
      error: publicError("INVALID_SUBMISSION_ID", "A valid submission id is required."),
      requestId: id
    });
    return;
  }

  if (!statusesForTable(table).has(status)) {
    sendJson(response, 400, {
      ok: false,
      error: publicError("INVALID_STATUS", "Invalid admin intake status."),
      requestId: id
    });
    return;
  }

  const patch = { status };
  if (table === "intake_submissions" && status !== "new") {
    patch.reviewed_by = userId;
    patch.reviewed_at = new Date().toISOString();
  }

  let result;
  try {
    result = await safeFetch(
      updateUrl(table, submissionId),
      {
        method: "PATCH",
        headers: {
          ...supabaseHeaders(supabaseServerKey()),
          Prefer: "return=representation",
          Accept: "application/json"
        },
        body: JSON.stringify(patch)
      },
      8_000
    );
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: publicError("ADMIN_INTAKE_UPDATE_FAILED", "Admin intake submission could not be updated."),
      requestId: id
    });
    return;
  }

  if (!result.ok) {
    await result.text();
    sendJson(response, 502, {
      ok: false,
      error: publicError("ADMIN_INTAKE_UPDATE_FAILED", "Admin intake submission could not be updated."),
      requestId: id
    });
    return;
  }

  const rows = await result.json();
  const submission = Array.isArray(rows) ? rows[0] : null;
  if (!submission) {
    sendJson(response, 404, {
      ok: false,
      error: publicError("INTAKE_SUBMISSION_NOT_FOUND", "Admin intake submission was not found."),
      requestId: id
    });
    return;
  }

  await writeAuditEvent({
    actorProfileId: userId,
    eventType: "admin.intake.status_update",
    entityTable: table,
    entityId: submission.id,
    afterData: {
      status: submission.status,
      reviewedBy: submission.reviewed_by || null,
      reviewedAt: submission.reviewed_at || null
    },
    request
  });

  sendJson(response, 200, {
    ok: true,
    data: {
      table,
      submission: normalizeSubmission(submission)
    },
    requestId: id
  });
}

module.exports = async function handler(request, response) {
  const id = requestId();

  if (handleAdminCorsPreflight(request, response, id, ["GET", "PATCH", "OPTIONS"])) return;

  if (!["GET", "PATCH"].includes(request.method)) {
    sendJson(response, 405, {
      ok: false,
      error: publicError("METHOD_NOT_ALLOWED", "Method not allowed."),
      requestId: id
    });
    return;
  }

  if (rejectDisallowedAdminOrigin(request, response, id)) return;

  const authenticated = await authenticateAdmin(request, response, id);
  if (!authenticated) return;

  let table;
  try {
    table = intakeTableName();
  } catch (error) {
    sendJson(response, 503, {
      ok: false,
      error: publicError("INTAKE_NOT_CONFIGURED", "Artihubs intake is not configured yet."),
      requestId: id
    });
    return;
  }

  if (request.method === "PATCH") {
    await updateSubmission({
      table,
      request,
      response,
      id,
      userId: authenticated.user.id
    });
    return;
  }

  try {
    await listSubmissions({ table, request, response, id });
  } catch (error) {
    const code = error.code === "INVALID_STATUS" || error.code === "INVALID_TYPE" ? error.code : "ADMIN_INTAKE_QUERY_FAILED";
    const status = code === "ADMIN_INTAKE_QUERY_FAILED" ? 502 : 400;
    sendJson(response, status, {
      ok: false,
      error: publicError(code, code === "ADMIN_INTAKE_QUERY_FAILED" ? "Admin intake submissions could not be loaded." : "Invalid admin intake filter."),
      requestId: id
    });
    return;
  }
};
