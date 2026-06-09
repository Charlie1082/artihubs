import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "node_modules"]);
const scannedExtensions = new Set([
  "",
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".toml",
  ".txt",
  ".yaml",
  ".yml"
]);

const secretPatterns = [
  {
    label: "anthropic_api_key",
    pattern: /\bsk-ant-api[0-9a-zA-Z_-]{20,}\b/g
  },
  {
    label: "openai_api_key",
    pattern: /\bsk-proj-[0-9a-zA-Z_-]{20,}\b|\bsk-[0-9a-zA-Z]{32,}\b/g
  },
  {
    label: "supabase_secret_key",
    pattern: /\bsb_secret_[0-9a-zA-Z_-]{16,}\b/g
  },
  {
    label: "github_token",
    pattern: /\bgh[pousr]_[0-9a-zA-Z_]{20,}\b/g
  },
  {
    label: "aws_access_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    label: "slack_token",
    pattern: /\bxox[baprs]-[0-9a-zA-Z-]{20,}\b/g
  },
  {
    label: "private_key_block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g
  }
];

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

    if (scannedExtensions.has(path.extname(entry.name)) || entry.name.startsWith(".env")) {
      files.push(fullPath);
    }
  }
  return files;
}

function relative(filePath) {
  return path.relative(projectRoot, filePath);
}

function readText(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

const files = walk(projectRoot).sort();
const findings = [];

for (const filePath of files) {
  const text = readText(filePath);
  if (text === null) continue;

  for (const rule of secretPatterns) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      findings.push({
        file: relative(filePath),
        pattern: rule.label
      });
    }
  }
}

const payload = {
  ok: findings.length === 0,
  checkedFiles: files.length,
  findings
};

if (findings.length > 0) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));
