import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const explicitDevtools = readArg("--devtools") || process.env.ORBIT_GEOMETRY_DEVTOOLS || "";
const explicitOrigin = readArg("--origin") || process.env.ORBIT_GEOMETRY_ORIGIN || "";
const routes = (readArg("--routes") || process.env.ORBIT_GEOMETRY_ROUTES || "/,/ko/")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const viewports = (readArg("--viewports") || process.env.ORBIT_GEOMETRY_VIEWPORTS || "1280x900,1440x900,1680x1050,2560x1440,390x844")
  .split(",")
  .map((item) => {
    const [width, height] = item.split("x").map(Number);
    return { width, height, mobile: width <= 640 };
  })
  .filter(({ width, height }) => Number.isFinite(width) && Number.isFinite(height));

const expectedRatios = {
  "draft1-primary": { rx: 1.18, ry: 0.34 },
  "draft4-cross": { rx: 1.28, ry: 0.43 },
  "draft1-low": { rx: 1.05, ry: 0.58 },
};

const cleanupTasks = [];

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function normalizeOrigin(value) {
  const trimmed = String(value || "").trim().replace(/\/$/, "");
  if (!trimmed) return "";
  return trimmed.replace(/^https:\/\/artihubs\.com$/u, "https://www.artihubs.com");
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
  }[extension] || "application/octet-stream";
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function startStaticServer() {
  const server = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(requestUrl.pathname);
      const relativePath = pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1);
      const filePath = path.resolve(projectRoot, relativePath || "index.html");
      const relative = path.relative(projectRoot, filePath);

      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": mimeType(filePath),
      });
      fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : "Server error");
    }
  });

  const port = await getFreePort();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  cleanupTasks.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${port}`;
}

function chromeCandidates() {
  return [
    process.env.CHROME_BIN,
    process.env.GOOGLE_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ].filter(Boolean);
}

function findChromeExecutable() {
  return chromeCandidates().find((candidate) => fs.existsSync(candidate)) || "";
}

async function waitForJson(url, timeoutMs = 8000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await wait(200);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

async function startChrome() {
  const executable = findChromeExecutable();
  if (!executable) throw new Error("No Chrome/Chromium executable found for orbit geometry check.");

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "artihubs-orbit-geometry-chrome-"));
  const chrome = spawn(executable, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-sandbox",
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  cleanupTasks.push(() => {
    if (!chrome.killed) chrome.kill("SIGTERM");
  });

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 10000);
  } catch (error) {
    throw new Error(`${error.message}${stderr ? `\nChrome stderr:\n${stderr.slice(-2000)}` : ""}`);
  }

  return `http://127.0.0.1:${port}`;
}

async function newTarget(devtoolsUrl, url) {
  const endpoint = `${devtoolsUrl}/json/new?${encodeURIComponent(url)}`;
  let response = await fetch(endpoint, { method: "PUT" }).catch(() => null);
  if (!response?.ok) response = await fetch(endpoint).catch(() => null);
  if (!response?.ok) throw new Error(`Could not create Chrome target for ${url}`);
  const target = await response.json();
  if (!target?.webSocketDebuggerUrl) throw new Error(`Chrome target missing websocket URL for ${url}`);
  return target;
}

function connectToTarget(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  let closed = false;

  function rejectPending(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  }

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (!payload.id || !pending.has(payload.id)) return;
    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);
    payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result);
  });
  socket.addEventListener("close", () => {
    closed = true;
    rejectPending(new Error("CDP target closed before command completed."));
  });
  socket.addEventListener("error", () => {
    closed = true;
    rejectPending(new Error("CDP websocket error before command completed."));
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not open CDP websocket.")), { once: true });
  });

  async function command(method, params = {}) {
    if (closed) throw new Error(`CDP target is closed before ${method}.`);
    const commandId = ++id;
    socket.send(JSON.stringify({ id: commandId, method, params }));
    return await new Promise((resolve, reject) => pending.set(commandId, { resolve, reject }));
  }

  return { command, ready, socket };
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function evaluateOrbitGeometryExpression() {
  return `(() => {
    const canvas = document.querySelector(".home-orbit-canvas");
    const orbit = canvas && canvas.closest(".home-orbit");
    const iframe = document.querySelector(".home-globe-frame");
    const fixedSvg = Boolean(document.querySelector(".home-orbit-svg, [id^='home-orbit-path']"));

    if (!canvas || !orbit || !iframe || !iframe.contentDocument) {
      return { ok: false, reason: "missing-orbit-or-iframe", fixedSvg };
    }

    const doc = iframe.contentDocument;
    const svg = doc.querySelector("#globe-svg");
    const circle = doc.querySelector("#globe-svg .rim, #globe-svg .ocean, #sphere-clip circle");
    if (!svg || !circle) {
      return { ok: false, reason: "missing-globe-sphere", fixedSvg };
    }

    const orbitRect = orbit.getBoundingClientRect();
    const iframeRect = iframe.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const scaleX = svgRect.width / viewBox.width;
    const scaleY = svgRect.height / viewBox.height;
    const scale = Math.min(scaleX, scaleY);
    const circleCx = circle.cx.baseVal.value;
    const circleCy = circle.cy.baseVal.value;
    const circleR = circle.r.baseVal.value;
    const measured = {
      cx: iframeRect.left + svgRect.left + (circleCx - viewBox.x) * scaleX - orbitRect.left,
      cy: iframeRect.top + svgRect.top + (circleCy - viewBox.y) * scaleY - orbitRect.top,
      r: circleR * scale,
    };
    const telemetry = {
      source: canvas.dataset.homeOrbitGeometrySource,
      cx: Number(canvas.dataset.homeOrbitCx),
      cy: Number(canvas.dataset.homeOrbitCy),
      r: Number(canvas.dataset.homeOrbitR),
      planeRatios: JSON.parse(canvas.dataset.homeOrbitPlaneRatios || "[]"),
    };
    const centerOffset = {
      x: Math.abs(telemetry.cx - measured.cx) / measured.r,
      y: Math.abs(telemetry.cy - measured.cy) / measured.r,
    };
    centerOffset.max = Math.max(centerOffset.x, centerOffset.y);
    const radiusOffset = Math.abs(telemetry.r - measured.r) / measured.r;

    return {
      ok: true,
      url: window.location.href,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fixedSvg,
      telemetry,
      measured,
      centerOffset,
      radiusOffset,
      orbitRect: { width: orbitRect.width, height: orbitRect.height },
    };
  })()`;
}

function validateMetrics(metrics, route, viewport) {
  const failures = [];
  if (!metrics.ok) failures.push(metrics.reason || "metrics-unavailable");
  if (metrics.fixedSvg) failures.push("fixed-svg-or-hardcoded-path-present");
  if (metrics.telemetry?.source !== "iframe-sphere") failures.push(`source-${metrics.telemetry?.source || "missing"}`);
  if (!(metrics.centerOffset?.max <= 0.02)) failures.push(`center-offset-${metrics.centerOffset?.max}`);
  if (!(metrics.radiusOffset <= 0.02)) failures.push(`radius-offset-${metrics.radiusOffset}`);

  const ratios = metrics.telemetry?.planeRatios || [];
  for (const [name, expected] of Object.entries(expectedRatios)) {
    const ratio = ratios.find((item) => item.name === name);
    if (!ratio) {
      failures.push(`missing-ratio-${name}`);
      continue;
    }

    const rxDelta = Math.abs(ratio.rx - expected.rx);
    const ryDelta = Math.abs(ratio.ry - expected.ry);
    if (rxDelta > 0.015) failures.push(`rx-${name}-${ratio.rx}`);
    if (ryDelta > 0.015) failures.push(`ry-${name}-${ratio.ry}`);
    if (ratio.rx < 1.03 || ratio.rx > 1.3) failures.push(`rx-range-${name}-${ratio.rx}`);
    if (ratio.ry < 0.3 || ratio.ry > 0.6) failures.push(`ry-range-${name}-${ratio.ry}`);
  }

  const widest = ratios.reduce((max, item) => Math.max(max, item.rx || 0), 0);
  if (widest < 1.18) failures.push(`beyond-globe-extent-${widest}`);

  return {
    ok: failures.length === 0,
    route,
    viewport,
    failures,
    metrics,
  };
}

async function evaluate(command, expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  }

  return result.result.value;
}

async function waitForOrbit(command) {
  return await evaluate(command, `new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const source = document.querySelector(".home-orbit-canvas")?.dataset.homeOrbitGeometrySource;
      if (source === "iframe-sphere" || Date.now() - started > 5000) {
        resolve(source || "missing");
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  })`);
}

async function inspect(devtoolsUrl, origin, route, viewport) {
  const url = new URL(route, `${origin}/`).toString();
  let target = null;
  let socket = null;

  try {
    target = await newTarget(devtoolsUrl, "about:blank");
    const connection = connectToTarget(target.webSocketDebuggerUrl);
    socket = connection.socket;
    await connection.ready;

    const { command } = connection;
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });
    await command("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });
    await command("Page.navigate", { url });
    await wait(1300);
    await waitForOrbit(command);

    const metrics = await evaluate(command, evaluateOrbitGeometryExpression());
    return validateMetrics(metrics, route, viewport);
  } catch (error) {
    return {
      ok: false,
      route,
      viewport,
      failures: ["inspection-error"],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    if (target?.id) {
      await fetch(`${devtoolsUrl}/json/close/${target.id}`).catch(() => {});
    }
  }
}

async function cleanup() {
  for (const task of cleanupTasks.reverse()) {
    await Promise.resolve()
      .then(task)
      .catch(() => {});
  }
}

function printAndExit(payload) {
  const output = JSON.stringify(payload, null, 2);
  if (payload.ok) {
    console.log(output);
    process.exitCode = 0;
  } else {
    console.error(output);
    process.exitCode = 1;
  }
}

try {
  const localOrigin = explicitOrigin ? "" : await startStaticServer();
  const localDevtools = explicitDevtools ? "" : await startChrome();
  const runOrigin = normalizeOrigin(explicitOrigin) || localOrigin;
  const runDevtoolsUrl = normalizeOrigin(explicitDevtools) || localDevtools;
  const results = [];

  for (const route of routes) {
    for (const viewport of viewports) {
      results.push(await inspect(runDevtoolsUrl, runOrigin, route, viewport));
    }
  }

  const failed = results.filter((result) => !result.ok);
  printAndExit({
    ok: failed.length === 0,
    origin: runOrigin,
    devtoolsUrl: runDevtoolsUrl,
    localServer: !explicitOrigin,
    localChrome: !explicitDevtools,
    viewports,
    routes,
    results,
  });
} catch (error) {
  printAndExit({
    ok: false,
    origin: normalizeOrigin(explicitOrigin),
    devtoolsUrl: normalizeOrigin(explicitDevtools),
    localServer: !explicitOrigin,
    localChrome: !explicitDevtools,
    failures: [
      {
        name: "orbit-geometry-bootstrap",
        error: error instanceof Error ? error.message : String(error),
      },
    ],
  });
} finally {
  await cleanup();
}
