const allowedTypes = new Set(["maker", "seeker", "intro", "general"]);

function send(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    send(response, 405, { error: "Method not allowed." });
    return;
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    send(response, 400, { error: "Invalid JSON body." });
    return;
  }

  const type = allowedTypes.has(payload.type) ? payload.type : "general";
  const email = String(payload.email || "").trim().toLowerCase();

  if (!isEmail(email)) {
    send(response, 400, { error: "A valid email is required." });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    send(response, 503, { error: "Artihubs intake database is not configured yet." });
    return;
  }

  const row = {
    type,
    name: String(payload.name || "").trim() || null,
    email,
    country: String(payload.country || "").trim() || null,
    region: String(payload.region || "").trim() || null,
    field: String(payload.field || "").trim() || null,
    message: String(payload.message || "").trim() || null,
    source_path: String(payload.sourcePath || "").trim() || null,
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}
  };

  const supabaseHeaders = {
    apikey: supabaseServiceRoleKey,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };

  if (!supabaseServiceRoleKey.startsWith("sb_")) {
    supabaseHeaders.Authorization = `Bearer ${supabaseServiceRoleKey}`;
  }

  const insertResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/public_intake`, {
    method: "POST",
    headers: supabaseHeaders,
    body: JSON.stringify(row)
  });

  if (!insertResponse.ok) {
    const detail = await insertResponse.text();
    send(response, 502, { error: "Intake database insert failed.", detail });
    return;
  }

  const data = await insertResponse.json();
  send(response, 200, { ok: true, intake: data[0] || null });
};
