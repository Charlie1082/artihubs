const devtoolsUrl = readArg("--devtools") || process.env.ORBIT_GEOMETRY_DEVTOOLS || "http://127.0.0.1:9223";
const origin = (readArg("--origin") || process.env.ORBIT_GEOMETRY_ORIGIN || "http://127.0.0.1:4173").replace(/\/$/, "");
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

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

async function connectToPage() {
  const targets = await fetch(`${devtoolsUrl}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("No Chrome DevTools page target found.");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (!payload.id || !pending.has(payload.id)) return;
    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) reject(new Error(payload.error.message));
    else resolve(payload.result);
  });

  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

  async function command(method, params = {}) {
    const commandId = ++id;
    socket.send(JSON.stringify({ id: commandId, method, params }));
    return await new Promise((resolve, reject) => pending.set(commandId, { resolve, reject }));
  }

  return { command, socket };
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

const { command, socket } = await connectToPage();
await command("Page.enable");
await command("Runtime.enable");

const results = [];

for (const route of routes) {
  for (const viewport of viewports) {
    await command("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });
    await command("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });
    await command("Page.navigate", { url: `${origin}${route}` });
    await wait(1300);
    await waitForOrbit(command);

    const metrics = await evaluate(command, evaluateOrbitGeometryExpression());
    results.push(validateMetrics(metrics, route, viewport));
  }
}

socket.close();

const failed = results.filter((result) => !result.ok);
const payload = {
  ok: failed.length === 0,
  origin,
  devtoolsUrl,
  viewports,
  routes,
  results,
};

const output = JSON.stringify(payload, null, 2);
if (failed.length > 0) {
  console.error(output);
  process.exit(1);
}

console.log(output);
