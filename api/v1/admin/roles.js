const { authenticateAdmin, handleAdminCorsPreflight, rejectDisallowedAdminOrigin } = require("../../_utils/admin-auth");
const { writeAuditEvent } = require("../../_utils/audit");
const { isJsonRequest, publicError, readJson, requestId, safeFetch, sendJson } = require("../../_utils/http");
const { supabaseHeaders, supabaseServerKey, supabaseUrl } = require("../../_utils/supabase");

const allowedRoles = new Set(["reviewer", "admin", "super_admin"]);
const MAX_PATCH_BODY_BYTES = 2_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function currentUrl(request) {
  return new URL(request.url || "/api/v1/admin/roles", "https://artihubs.local");
}

function listLimit(url) {
  const raw = Number(url.searchParams.get("limit") || 50);
  if (!Number.isFinite(raw)) return 50;
  return Math.min(100, Math.max(1, Math.trunc(raw)));
}

function normalizeRole(row) {
  return {
    profileId: row.profile_id,
    role: row.role,
    grantedBy: row.granted_by || null,
    grantedAt: row.granted_at || null
  };
}

function rolesListUrl(request) {
  const inputUrl = currentUrl(request);
  const url = new URL(`${supabaseUrl()}/rest/v1/admin_roles`);
  url.searchParams.set("select", "profile_id,role,granted_by,granted_at");
  url.searchParams.set("order", "granted_at.desc");
  url.searchParams.set("limit", String(listLimit(inputUrl)));

  const role = inputUrl.searchParams.get("role");
  if (role) {
    if (!allowedRoles.has(role)) {
      const error = new Error("invalid_role");
      error.code = "INVALID_ROLE";
      throw error;
    }
    url.searchParams.set("role", `eq.${role}`);
  }

  return url;
}

async function listRoles({ request, response, id }) {
  let url;
  try {
    url = rolesListUrl(request);
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: publicError(error.code || "INVALID_ROLE_FILTER", "Invalid admin role filter."),
      requestId: id
    });
    return;
  }

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
      error: publicError("ADMIN_ROLES_QUERY_FAILED", "Admin roles could not be loaded."),
      requestId: id
    });
    return;
  }

  if (!result.ok) {
    await result.text();
    sendJson(response, 502, {
      ok: false,
      error: publicError("ADMIN_ROLES_QUERY_FAILED", "Admin roles could not be loaded."),
      requestId: id
    });
    return;
  }

  const rows = await result.json();
  const roles = Array.isArray(rows) ? rows.map(normalizeRole) : [];

  sendJson(response, 200, {
    ok: true,
    data: {
      count: roles.length,
      roles
    },
    requestId: id
  });
}

async function upsertRole({ request, response, id, actorProfileId }) {
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

  const profileId = String(payload.profileId || "").trim();
  const role = String(payload.role || "").trim();

  if (!uuidPattern.test(profileId)) {
    sendJson(response, 400, {
      ok: false,
      error: publicError("INVALID_PROFILE_ID", "A valid profile id is required."),
      requestId: id
    });
    return;
  }

  if (!allowedRoles.has(role)) {
    sendJson(response, 400, {
      ok: false,
      error: publicError("INVALID_ROLE", "Invalid admin role."),
      requestId: id
    });
    return;
  }

  if (profileId === actorProfileId) {
    sendJson(response, 400, {
      ok: false,
      error: publicError("SELF_ROLE_CHANGE_NOT_ALLOWED", "Self role changes are not allowed."),
      requestId: id
    });
    return;
  }

  const row = {
    profile_id: profileId,
    role,
    granted_by: actorProfileId,
    granted_at: new Date().toISOString()
  };

  let result;
  try {
    const url = new URL(`${supabaseUrl()}/rest/v1/admin_roles`);
    url.searchParams.set("on_conflict", "profile_id");
    result = await safeFetch(
      url,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(supabaseServerKey()),
          Prefer: "resolution=merge-duplicates,return=representation",
          Accept: "application/json"
        },
        body: JSON.stringify(row)
      },
      8_000
    );
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: publicError("ADMIN_ROLE_UPDATE_FAILED", "Admin role could not be updated."),
      requestId: id
    });
    return;
  }

  if (!result.ok) {
    await result.text();
    sendJson(response, 502, {
      ok: false,
      error: publicError("ADMIN_ROLE_UPDATE_FAILED", "Admin role could not be updated."),
      requestId: id
    });
    return;
  }

  const rows = await result.json();
  const adminRole = Array.isArray(rows) ? rows[0] : null;
  if (!adminRole) {
    sendJson(response, 502, {
      ok: false,
      error: publicError("ADMIN_ROLE_UPDATE_FAILED", "Admin role could not be updated."),
      requestId: id
    });
    return;
  }

  await writeAuditEvent({
    actorProfileId,
    eventType: "admin.role.upsert",
    entityTable: "admin_roles",
    entityId: profileId,
    afterData: {
      role: adminRole.role,
      reviewedBy: actorProfileId
    },
    request
  });

  sendJson(response, 200, {
    ok: true,
    data: {
      role: normalizeRole(adminRole)
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

  const authenticated = await authenticateAdmin(request, response, id, ["super_admin"]);
  if (!authenticated) return;

  if (request.method === "PATCH") {
    await upsertRole({
      request,
      response,
      id,
      actorProfileId: authenticated.user.id
    });
    return;
  }

  await listRoles({ request, response, id });
};
