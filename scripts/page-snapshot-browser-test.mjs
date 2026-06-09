import fs from "node:fs";
import path from "node:path";

const devtoolsUrl = process.argv[2] || "http://127.0.0.1:9223";
const pageUrl = process.argv[3] || "http://127.0.0.1:4173/";
const screenshotPath = process.argv[4] || "/private/tmp/artihubs-page-snapshot.png";
const width = Number(process.argv[5]) || 1280;
const height = Number(process.argv[6]) || 900;

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

const { command, socket } = await connectToPage();
await command("Page.enable");
await command("Runtime.enable");
await command("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width <= 640
});
await command("Page.navigate", { url: pageUrl });
await new Promise((resolve) => setTimeout(resolve, 1_100));

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return result.result.value;
}

const snapshot = {
  url: await evaluate("window.location.href"),
  title: await evaluate("document.title"),
  h1: await evaluate("document.querySelector('h1')?.textContent || ''"),
  navText: await evaluate("Array.from(document.querySelectorAll('.nav-links a')).map((a) => a.textContent.trim()).join(' | ')"),
  width: await evaluate("window.innerWidth"),
  scrollWidth: await evaluate("document.documentElement.scrollWidth"),
  overflowX: await evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
};

const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
socket.close();

console.log(JSON.stringify({ ok: !snapshot.overflowX, screenshotPath, ...snapshot }, null, 2));
if (snapshot.overflowX) process.exit(1);
