const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usage() {
  return [
    "Usage: node scripts/generate-super-admin-bootstrap-sql.mjs <profile_uuid> [--granted-by <profile_uuid>]",
    "",
    "Generates review-only SQL for bootstrapping the first Artihubs super_admin.",
    "Run the SQL only after the target Supabase Auth user and public.profiles row are verified."
  ].join("\n");
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, usage: usage() }, null, 2));
  process.exit(1);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const profileId = args[0];
if (!uuidPattern.test(profileId || "")) {
  fail("A valid target profile UUID is required.");
}

let grantedBy = null;
const grantedByIndex = args.indexOf("--granted-by");
if (grantedByIndex !== -1) {
  grantedBy = args[grantedByIndex + 1] || "";
  if (!uuidPattern.test(grantedBy)) fail("--granted-by must be a valid profile UUID.");
}

const targetLiteral = sqlString(profileId.toLowerCase());
const grantedByLiteral = grantedBy ? `${sqlString(grantedBy.toLowerCase())}::uuid` : "null";

const sql = `-- Artihubs first super_admin bootstrap SQL
-- Review before running. Execute only in the intended Supabase project
-- after confirming the target Auth user and public.profiles row.

do $$
declare
  target_profile_id uuid := ${targetLiteral}::uuid;
  granted_by_profile_id uuid := ${grantedByLiteral};
begin
  if not exists (
    select 1
    from public.profiles
    where id = target_profile_id
  ) then
    raise exception 'Target profile % does not exist in public.profiles', target_profile_id;
  end if;

  insert into public.admin_roles (profile_id, role, granted_by, granted_at)
  values (target_profile_id, 'super_admin', granted_by_profile_id, now())
  on conflict (profile_id) do update
    set role = 'super_admin',
        granted_by = excluded.granted_by,
        granted_at = now();
end $$;
`;

console.log(sql);
