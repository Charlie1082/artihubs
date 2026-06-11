import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://www.artihubs.com";
const pages = [
  { slug: "", enFile: "index.html", koFile: "ko/index.html", enUrl: "/", koUrl: "/ko/" },
  { slug: "explore", enFile: "explore/index.html", koFile: "ko/explore/index.html", enUrl: "/explore/", koUrl: "/ko/explore/" },
  { slug: "for-makers", enFile: "for-makers/index.html", koFile: "ko/for-makers/index.html", enUrl: "/for-makers/", koUrl: "/ko/for-makers/" },
  { slug: "for-seekers", enFile: "for-seekers/index.html", koFile: "ko/for-seekers/index.html", enUrl: "/for-seekers/", koUrl: "/ko/for-seekers/" },
  { slug: "living-globe-v2", enFile: "living-globe-v2/index.html", koFile: "ko/living-globe-v2/index.html", enUrl: "/living-globe-v2/", koUrl: "/ko/living-globe-v2/" },
  { slug: "login", enFile: "login/index.html", koFile: "ko/login/index.html", enUrl: "/login/", koUrl: "/ko/login/" },
  { slug: "signup", enFile: "signup/index.html", koFile: "ko/signup/index.html", enUrl: "/signup/", koUrl: "/ko/signup/" },
  { slug: "welcome", enFile: "welcome/index.html", koFile: "ko/welcome/index.html", enUrl: "/welcome/", koUrl: "/ko/welcome/" },
  { slug: "account", enFile: "account/index.html", koFile: "ko/account/index.html", enUrl: "/account/", koUrl: "/ko/account/" },
  { slug: "privacy", enFile: "privacy/index.html", koFile: "ko/privacy/index.html", enUrl: "/privacy/", koUrl: "/ko/privacy/" },
  { slug: "terms", enFile: "terms/index.html", koFile: "ko/terms/index.html", enUrl: "/terms/", koUrl: "/ko/terms/" },
];

const internalSlugs = pages.filter((page) => page.slug).map((page) => page.slug);
const failures = [];

function read(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    failures.push({ file: relativePath, reason: "missing-file" });
    return "";
  }
  return fs.readFileSync(fullPath, "utf8");
}

function expectIncludes(file, html, needle, reason) {
  if (!html.includes(needle)) failures.push({ file, reason, expected: needle });
}

for (const page of pages) {
  const en = read(page.enFile);
  const ko = read(page.koFile);
  if (!en || !ko) continue;

  expectIncludes(page.enFile, en, `<link rel="alternate" hreflang="en" href="${origin}${page.enUrl}"`, "missing-en-hreflang-self");
  expectIncludes(page.enFile, en, `<link rel="alternate" hreflang="ko" href="${origin}${page.koUrl}"`, "missing-en-hreflang-ko");
  expectIncludes(page.koFile, ko, `<html lang="ko">`, "missing-ko-lang");
  expectIncludes(page.koFile, ko, `<link rel="canonical" href="${origin}${page.koUrl}"`, "missing-ko-canonical");
  expectIncludes(page.koFile, ko, `<link rel="alternate" hreflang="en" href="${origin}${page.enUrl}"`, "missing-ko-hreflang-en");
  expectIncludes(page.koFile, ko, `<link rel="alternate" hreflang="ko" href="${origin}${page.koUrl}"`, "missing-ko-hreflang-self");
  expectIncludes(page.enFile, en, `href="${page.koUrl === "/ko/" ? "./ko/" : `../ko/${page.slug}/`}"`, "missing-en-to-ko-toggle");
  expectIncludes(page.koFile, ko, `href="${page.slug ? `../../${page.slug}/` : "../"}"`, "missing-ko-to-en-toggle");

  if (/ca불가nical|k불가w/.test(ko)) {
    failures.push({ file: page.koFile, reason: "known-ko-generation-token-corruption" });
  }
}

const koHome = read("ko/index.html");
for (const slug of internalSlugs) {
  if (koHome.includes(`href="../${slug}/"`)) {
    failures.push({ file: "ko/index.html", reason: "ko-home-link-leaves-ko-namespace", href: `../${slug}/` });
  }
}

const payload = {
  ok: failures.length === 0,
  checkedPairs: pages.length,
  failures,
};

if (failures.length) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));
