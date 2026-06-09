import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(projectRoot, "scripts", "generate-super-admin-bootstrap-sql.mjs");
const validProfileId = "11111111-1111-4111-8111-111111111111";
const validGranterId = "22222222-2222-4222-8222-222222222222";

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    encoding: "utf8"
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const invalidResult = run(["not-a-uuid"]);
assert(invalidResult.status === 1, "invalid profile UUID should be rejected");
assert(invalidResult.stderr.includes("valid target profile UUID"), "invalid UUID error should explain the profile UUID requirement");

const validResult = run([validProfileId, "--granted-by", validGranterId]);
assert(validResult.status === 0, "valid profile UUID should generate SQL");
assert(validResult.stdout.includes("insert into public.admin_roles"), "bootstrap SQL should insert into admin_roles");
assert(validResult.stdout.includes("'super_admin'"), "bootstrap SQL should grant super_admin");
assert(validResult.stdout.includes(validProfileId), "bootstrap SQL should include target profile id");
assert(validResult.stdout.includes(validGranterId), "bootstrap SQL should include granted_by profile id");
assert(!validResult.stdout.includes("PROFILE_UUID_HERE"), "bootstrap SQL must not contain placeholder profile ids");
assert(validResult.stdout.includes("does not exist in public.profiles"), "bootstrap SQL should fail closed when the profile row is absent");

console.log(
  JSON.stringify(
    {
      ok: true,
      invalidUuid: "rejected",
      validSql: "generated",
      profileExistenceGuard: "present"
    },
    null,
    2
  )
);
