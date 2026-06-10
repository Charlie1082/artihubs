import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteOrigin = "https://www.artihubs.com";
const ogImage = `${siteOrigin}/assets/seo/og-artihubs-living-globe-1200x630.png`;

const indexedPages = [
  { file: "index.html", canonical: `${siteOrigin}/`, jsonLd: true },
  { file: "ko/index.html", canonical: `${siteOrigin}/ko/` },
  { file: "living-globe-v2/index.html", canonical: `${siteOrigin}/living-globe-v2/` },
  { file: "explore/index.html", canonical: `${siteOrigin}/explore/` },
  { file: "for-makers/index.html", canonical: `${siteOrigin}/for-makers/` },
  { file: "for-seekers/index.html", canonical: `${siteOrigin}/for-seekers/` },
  { file: "signup/index.html", canonical: `${siteOrigin}/signup/` },
  { file: "login/index.html", canonical: `${siteOrigin}/login/` }
];

const noindexPages = [
  { file: "account/index.html", canonical: `${siteOrigin}/account/` },
  { file: "welcome/index.html", canonical: `${siteOrigin}/welcome/` },
  { file: "cofounder-mockup/index.html", canonical: `${siteOrigin}/cofounder-mockup/` },
  { file: "privacy/index.html", canonical: `${siteOrigin}/privacy/` },
  { file: "terms/index.html", canonical: `${siteOrigin}/terms/` }
];

const requiredAssets = [
  "favicon.ico",
  "site.webmanifest",
  "assets/artihubs-favicon.svg",
  "assets/favicon-32x32.png",
  "assets/apple-touch-icon.png",
  "assets/android-chrome-192x192.png",
  "assets/android-chrome-512x512.png",
  "assets/seo/og-artihubs-living-globe-1200x630.png",
  "assets/seo/og-artihubs-living-globe-1200x630.svg",
  "robots.txt",
  "sitemap.xml"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function hasMeta(text, attribute, value) {
  return new RegExp(`<meta[^>]+${attribute}=["']${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i").test(text);
}

function hasTag(text, tagPattern) {
  return new RegExp(tagPattern, "i").test(text);
}

function checkPage(page, { indexed }) {
  const text = read(page.file);
  assert(hasTag(text, `<title>[^<]+</title>`), `${page.file} must define a title.`);
  assert(hasMeta(text, "name", "description"), `${page.file} must define meta description.`);
  assert(text.includes(`<link rel="canonical" href="${page.canonical}" />`), `${page.file} must define canonical ${page.canonical}.`);
  assert(hasMeta(text, "property", "og:title"), `${page.file} must define og:title.`);
  assert(hasMeta(text, "property", "og:description"), `${page.file} must define og:description.`);
  assert(text.includes(`<meta property="og:url" content="${page.canonical}" />`), `${page.file} must define matching og:url.`);
  assert(text.includes(`<meta property="og:image" content="${ogImage}" />`), `${page.file} must use the approved OG image.`);
  assert(hasMeta(text, "name", "twitter:card"), `${page.file} must define twitter:card.`);
  assert(hasMeta(text, "name", "twitter:title"), `${page.file} must define twitter:title.`);
  assert(hasMeta(text, "name", "twitter:description"), `${page.file} must define twitter:description.`);
  assert(text.includes(`<meta name="twitter:image" content="${ogImage}" />`), `${page.file} must define twitter:image.`);
  assert(text.includes('rel="icon"'), `${page.file} must link favicon assets.`);
  assert(text.includes('rel="manifest"'), `${page.file} must link the web manifest.`);
  if (indexed) {
    assert(!/name=["']robots["'][^>]+noindex/i.test(text), `${page.file} must not be noindexed.`);
  } else {
    assert(/<meta[^>]+name=["']robots["'][^>]+content=["']noindex, nofollow["']/i.test(text), `${page.file} must stay noindex.`);
  }
  if (page.jsonLd) {
    assert(/<script type=["']application\/ld\+json["']>[\s\S]*"@type": "Organization"[\s\S]*<\/script>/i.test(text), `${page.file} must include Organization JSON-LD.`);
  }
}

for (const asset of requiredAssets) {
  const fullPath = path.join(projectRoot, asset);
  assert(fs.existsSync(fullPath), `${asset} must exist.`);
  assert(fs.statSync(fullPath).size > 0, `${asset} must not be empty.`);
}

for (const page of indexedPages) checkPage(page, { indexed: true });
for (const page of noindexPages) checkPage(page, { indexed: false });

const robots = read("robots.txt");
assert(robots.includes("Disallow: /api/"), "robots.txt must exclude API routes.");
assert(robots.includes("Disallow: /privacy/"), "robots.txt must keep unapproved legal routes out of indexing.");
assert(robots.includes("Disallow: /terms/"), "robots.txt must keep unapproved legal routes out of indexing.");
assert(robots.includes(`Sitemap: ${siteOrigin}/sitemap.xml`), "robots.txt must link the sitemap.");

const sitemap = read("sitemap.xml");
for (const page of indexedPages) {
  assert(sitemap.includes(`<loc>${page.canonical}</loc>`), `sitemap.xml must include ${page.canonical}.`);
}
for (const page of noindexPages) {
  assert(!sitemap.includes(`<loc>${page.canonical}</loc>`), `sitemap.xml must not include ${page.canonical}.`);
}

const manifest = JSON.parse(read("site.webmanifest"));
assert(manifest.name === "Artihubs", "site.webmanifest must define the Artihubs app name.");
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "site.webmanifest must define install icons.");

console.log(
  JSON.stringify(
    {
      ok: true,
      indexedPages: indexedPages.length,
      noindexPages: noindexPages.length,
      requiredAssets: requiredAssets.length,
      legalRoutes: "noindex_and_excluded_from_sitemap"
    },
    null,
    2
  )
);
