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
const koLeakageGuardFiles = new Set([
  "ko/signup/index.html",
  "ko/for-makers/index.html",
  "ko/for-seekers/index.html",
  "ko/explore/index.html",
  "ko/account/index.html",
]);
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

// --- KO visible-copy leakage guard (AQA-0012-01 rework requirement) ---
// Flags ordinary English interface copy and corrupted Latin/Hangul hybrid
// tokens in /ko/* visible text, outside the AL-0056 keep-English glossary.

const koAllowedPhrases = [
  "Explore Hubs",
  "For Makers",
  // RQ-0015 Addendum 1: locale-invariant English nav + CS-3 labels
  "Globe Navigation",
  "For Finders",
  "Sign in",
  "Sign Up",
  "Contact Support",
  "Scanning signal...",
  "Living Globe",
  "Open Living Globe",
  "Maker Tag",
  "Maker Tag.",
  "Request Tag",
  "Request Tag.",
  "Grounded Maker Tags",
  "Product surfaces",
  "Signals become working records.",
  "Private draft",
  "Review gate",
  "Public signal",
  "Structured inquiry",
  "Globe Map",
  "AI ARX",
  "AI ARX(AI 아릭스)",
  "ARX",
  "Cold DM",
  "Finder",
  "Quiet Forge Lab",
  "Hanbit Interface",
  "Harbor Microfactory",
  "Patchworks Motion",
  "Signal Loom",
  "Lone Star Fixtures",
  "Banyan MicroWorks",
  "Open Loom Studio",
  "Machi Repair Works",
  "Northline Repair",
  "Campo Modular",
];

const koAllowedWords = new Set([
  "artihubs",
  "arx",
  "finder",
  "finders",
  "tag",
  "tags",
  "globe",
  "map",
  "navigation",
  "product",
  "surfaces",
  "signals",
  "become",
  "working",
  "records",
  "private",
  "draft",
  "review",
  "gate",
  "public",
  "structured",
  "inquiry",
  "sign",
  "contact",
  "support",
  "explore",
  "maker",
  "makers",
  "seeker",
  "seekers",
  "english",
  "ai",
  "dm",
  "cad",
  "cnc",
  "auth",
  "intake",
  "ok",
]);

const dynamicScriptRequirements = [
  {
    file: "auth-flow.js",
    markers: [
      "isKoreanMode",
      "올바른 이메일 주소",
      "비공개 계정을 만드는 중",
      "데모 계정이 생성되었습니다",
      "비밀번호 재설정 이메일",
    ],
  },
  {
    file: "account/account.js",
    markers: [
      "isKoreanMode",
      "로그아웃 상태",
      "계정 만들기",
      "로그인 중",
      "서버 Auth 확인 중",
      "로그아웃되었습니다",
    ],
  },
  {
    file: "site.js",
    markers: [
      "isKoreanMode",
      "제출 중",
      "접수되었습니다",
      "원격 접수는 아직 사용할 수 없습니다",
      "Artihubs 접수가 일시적으로 중단되었습니다",
    ],
  },
  {
    file: "explore/explore.js",
    markers: [
      "isKoreanMode",
      "ARX가 등록된 Maker Tag를 검색하는 중",
      "아직 근거 있는 Maker Tag가 없습니다",
      "메이커 데이터를 불러오지 못했습니다",
      "Artihubs가 이 검색을 완료하지 못했습니다",
    ],
  },
];

function visibleSegments(html) {
  const body = (html.split(/<body[^>]*>/i)[1] || html).split(/<\/body>/i)[0] || "";
  const withoutBlocks = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const segments = [];
  for (const match of withoutBlocks.matchAll(/>([^<>]+)</g)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (text) segments.push(text);
  }
  for (const match of withoutBlocks.matchAll(/(?:placeholder|aria-label|alt|title)="([^"]*)"/g)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (text) segments.push(text);
  }
  return segments;
}

function stripAllowed(segment) {
  let result = segment
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  for (const phrase of [...koAllowedPhrases].sort((a, b) => b.length - a.length)) {
    result = result.split(phrase).join(" ");
  }
  return result;
}

function checkKoVisibleCopy(file, html) {
  for (const rawSegment of visibleSegments(html)) {
    const segment = stripAllowed(rawSegment);

    // Hangul immediately followed by Latin is never natural Korean spacing.
    if (/[가-힣][A-Za-z]/.test(segment)) {
      failures.push({ file, reason: "ko-corrupted-hybrid-token", segment: rawSegment.slice(0, 120) });
      continue;
    }

    // Latin immediately followed by Hangul is only natural for glossary stems
    // taking a Korean particle (e.g. "Artihubs가", "Explore는").
    let corrupted = false;
    for (const match of segment.matchAll(/([A-Za-z]+)(?=[가-힣])/g)) {
      if (!koAllowedWords.has(match[1].toLowerCase())) {
        failures.push({ file, reason: "ko-corrupted-hybrid-token", segment: rawSegment.slice(0, 120), token: match[1] });
        corrupted = true;
        break;
      }
    }
    if (corrupted) continue;

    // Any standalone English word outside the glossary is visible leakage.
    const tokens = segment.split(/\s+/);
    const leaks = [];
    for (const token of tokens) {
      const word = token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
      if (!word || !/^[A-Za-z]+$/.test(word)) continue;
      if (/^[A-Z]{1,3}$/.test(word)) continue;
      if (!koAllowedWords.has(word.toLowerCase())) leaks.push(word);
    }
    if (leaks.length) {
      failures.push({ file, reason: "ko-visible-english-leak", segment: rawSegment.slice(0, 120), words: leaks.slice(0, 8) });
    }
  }
}

for (const page of pages) {
  if (!koLeakageGuardFiles.has(page.koFile)) continue;
  const koPath = path.join(projectRoot, page.koFile);
  if (!fs.existsSync(koPath)) continue;
  checkKoVisibleCopy(page.koFile, fs.readFileSync(koPath, "utf8"));
}

for (const { file, markers } of dynamicScriptRequirements) {
  const source = read(file);
  if (!source) continue;
  for (const marker of markers) {
    if (!source.includes(marker)) {
      failures.push({ file, reason: "missing-ko-dynamic-string-coverage", expected: marker });
    }
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
