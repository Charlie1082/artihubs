const crypto = require("node:crypto");
const { clientIp, safeFetch } = require("./http");
const { hasSupabaseServerConfig, supabaseHeaders, supabaseServerKey, supabaseUrl } = require("./supabase");

function usableAuditIpHashSecret() {
  const secret = String(process.env.AUDIT_IP_HASH_SECRET || "");
  if (!secret || secret.length < 32 || /^(replace-|https:\/\/your-project-ref\.supabase\.co)/.test(secret)) {
    return "";
  }
  return secret;
}

function ipHash(request) {
  const secret = usableAuditIpHashSecret();
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(clientIp(request)).digest("hex");
}

async function writeAuditEvent({
  actorProfileId,
  actorType = "admin",
  eventType,
  entityTable,
  entityId,
  beforeData = null,
  afterData = null,
  request
}) {
  if (!hasSupabaseServerConfig()) return { ok: false, skipped: true };

  const row = {
    actor_profile_id: actorProfileId || null,
    actor_type: actorType,
    event_type: eventType,
    entity_table: entityTable,
    entity_id: entityId || null,
    before_data: beforeData,
    after_data: afterData,
    ip_hash: request ? ipHash(request) : null,
    user_agent: String(request?.headers?.["user-agent"] || "").slice(0, 240) || null
  };

  try {
    const response = await safeFetch(
      `${supabaseUrl()}/rest/v1/audit_events`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(supabaseServerKey()),
          Prefer: "return=minimal"
        },
        body: JSON.stringify(row)
      },
      4_000
    );

    return { ok: response.ok, skipped: false };
  } catch (error) {
    return { ok: false, skipped: false };
  }
}

module.exports = {
  writeAuditEvent
};
