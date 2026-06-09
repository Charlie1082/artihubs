const { authenticateAdmin, handleAdminCorsPreflight, rejectDisallowedAdminOrigin } = require("../../_utils/admin-auth");
const { publicError, requestId, safeFetch, sendJson } = require("../../_utils/http");
const { supabaseHeaders, supabaseServerKey, supabaseUrl } = require("../../_utils/supabase");

const allowedEntityTables = new Set([
  "admin_roles",
  "audit_events",
  "intake_submissions",
  "intro_requests",
  "maker_profiles",
  "organization_memberships",
  "organizations",
  "profiles",
  "public_intake",
  "public_maker_profiles",
  "search_query_logs",
  "seeker_requests"
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const auditSelect = [
  "id",
  "actor_profile_id",
  "actor_type",
  "event_type",
  "entity_table",
  "entity_id",
  "after_data",
  "ip_hash",
  "created_at"
].join(",");

function currentUrl(request) {
  return new URL(request.url || "/api/v1/admin/audit-events", "https://artihubs.local");
}

function listLimit(url) {
  const raw = Number(url.searchParams.get("limit") || 25);
  if (!Number.isFinite(raw)) return 25;
  return Math.min(100, Math.max(1, Math.trunc(raw)));
}

function safeAuditData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = {};
  ["status", "role", "reviewedBy", "reviewedAt", "convertedEntityType", "convertedEntityId"].forEach((key) => {
    if (typeof value[key] === "string") allowed[key] = value[key].slice(0, 160);
  });
  return allowed;
}

function normalizeAuditEvent(row) {
  return {
    id: row.id,
    actorProfileId: row.actor_profile_id || null,
    actorType: row.actor_type,
    eventType: row.event_type,
    entityTable: row.entity_table,
    entityId: row.entity_id || null,
    afterData: safeAuditData(row.after_data),
    ipHashPresent: Boolean(row.ip_hash),
    createdAt: row.created_at
  };
}

function auditQueryUrl(request) {
  const inputUrl = currentUrl(request);
  const url = new URL(`${supabaseUrl()}/rest/v1/audit_events`);
  url.searchParams.set("select", auditSelect);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(listLimit(inputUrl)));

  const entityTable = inputUrl.searchParams.get("entityTable");
  if (entityTable) {
    if (!allowedEntityTables.has(entityTable)) {
      const error = new Error("invalid_entity_table");
      error.code = "INVALID_ENTITY_TABLE";
      throw error;
    }
    url.searchParams.set("entity_table", `eq.${entityTable}`);
  }

  const entityId = inputUrl.searchParams.get("entityId");
  if (entityId) {
    if (!uuidPattern.test(entityId)) {
      const error = new Error("invalid_entity_id");
      error.code = "INVALID_ENTITY_ID";
      throw error;
    }
    url.searchParams.set("entity_id", `eq.${entityId}`);
  }

  const eventType = inputUrl.searchParams.get("eventType");
  if (eventType) {
    if (!/^[a-z0-9._:-]{3,80}$/i.test(eventType)) {
      const error = new Error("invalid_event_type");
      error.code = "INVALID_EVENT_TYPE";
      throw error;
    }
    url.searchParams.set("event_type", `eq.${eventType}`);
  }

  return url;
}

module.exports = async function handler(request, response) {
  const id = requestId();

  if (handleAdminCorsPreflight(request, response, id, ["GET", "OPTIONS"])) return;

  if (request.method !== "GET") {
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

  let url;
  try {
    url = auditQueryUrl(request);
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: publicError(error.code || "INVALID_AUDIT_FILTER", "Invalid audit event filter."),
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
      error: publicError("AUDIT_EVENTS_QUERY_FAILED", "Audit events could not be loaded."),
      requestId: id
    });
    return;
  }

  if (!result.ok) {
    await result.text();
    sendJson(response, 502, {
      ok: false,
      error: publicError("AUDIT_EVENTS_QUERY_FAILED", "Audit events could not be loaded."),
      requestId: id
    });
    return;
  }

  const rows = await result.json();
  const events = Array.isArray(rows) ? rows.map(normalizeAuditEvent) : [];

  sendJson(response, 200, {
    ok: true,
    data: {
      count: events.length,
      events
    },
    requestId: id
  });
};
