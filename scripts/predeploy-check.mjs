import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.join(projectRoot, "..");
const workspaceMigrationCheck = path.join(workspaceRoot, "docs/deployment/validate-migrations.mjs");

const checks = [
  {
    name: "syntax",
    cwd: projectRoot,
    args: ["scripts/syntax-check.mjs"]
  },
  {
    name: "ko-parity",
    cwd: projectRoot,
    args: ["scripts/ko-parity-check.mjs"]
  },
  {
    name: "env",
    cwd: projectRoot,
    args: ["scripts/check-env.mjs"]
  },
  {
    name: "config",
    cwd: projectRoot,
    args: ["scripts/config-smoke-test.mjs"]
  },
  {
    name: "bootstrap-sql",
    cwd: projectRoot,
    args: ["scripts/bootstrap-sql-smoke-test.mjs"]
  },
  {
    name: "client-security",
    cwd: projectRoot,
    args: ["scripts/client-security-smoke-test.mjs"]
  },
  {
    name: "seo",
    cwd: projectRoot,
    args: ["scripts/seo-smoke-test.mjs"]
  },
  {
    name: "secrets",
    cwd: projectRoot,
    args: ["scripts/secrets-smoke-test.mjs"]
  },
  {
    name: "api",
    cwd: projectRoot,
    args: ["scripts/api-smoke-test.mjs"]
  },
  {
    name: "migrations",
    cwd: workspaceRoot,
    args: ["docs/deployment/validate-migrations.mjs"],
    optionalWhenMissing: workspaceMigrationCheck
  }
];

function runCheck(check) {
  if (check.optionalWhenMissing && !fs.existsSync(check.optionalWhenMissing)) {
    return {
      name: check.name,
      ok: true,
      status: 0,
      summary: {
        ok: true,
        skipped: true,
        reason: "workspace_migration_validator_not_present_in_deployable_repo"
      },
      stderr: ""
    };
  }

  const result = spawnSync(process.execPath, check.args, {
    cwd: check.cwd,
    encoding: "utf8"
  });

  let parsed = null;
  const output = result.stdout.trim() || result.stderr.trim();
  try {
    parsed = output ? JSON.parse(output) : null;
  } catch (error) {
    parsed = null;
  }

  return {
    name: check.name,
    ok: result.status === 0,
    status: result.status,
    summary: parsed,
    stderr: result.status === 0 ? "" : result.stderr.trim()
  };
}

const results = checks.map(runCheck);
const failed = results.filter((result) => !result.ok);

const payload = {
  ok: failed.length === 0,
  checks: results.map((result) => ({
    name: result.name,
    ok: result.ok,
    status: result.status,
    summary: result.summary
  }))
};

if (failed.length > 0) {
  payload.failures = failed.map((result) => ({
    name: result.name,
    status: result.status,
    stderr: result.stderr
  }));
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));
