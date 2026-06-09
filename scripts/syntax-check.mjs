import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "data", "deployment", "node_modules"]);
const checkedExtensions = new Set([".js", ".mjs"]);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...walk(fullPath));
      }
      continue;
    }

    if (checkedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function relative(filePath) {
  return path.relative(projectRoot, filePath);
}

const files = walk(projectRoot).sort();
const failures = [];

for (const filePath of files) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    failures.push({
      file: relative(filePath),
      status: result.status,
      stderr: result.stderr.trim()
    });
  }
}

const payload = {
  ok: failures.length === 0,
  checkedFiles: files.length,
  failures
};

if (failures.length > 0) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));
