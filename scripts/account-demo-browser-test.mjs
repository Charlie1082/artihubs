import fs from "node:fs";
import path from "node:path";

const devtoolsUrl = process.argv[2] || "http://127.0.0.1:9223";
const pageUrl = process.argv[3] || "http://127.0.0.1:4173/account/";
const screenshotPath = process.argv[4] || "/private/tmp/artihubs-account-demo.png";

async function connectToPage() {
  const targets = await fetch(`${devtoolsUrl}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.url.includes("/account/")) || targets.find((item) => item.type === "page");
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

async function main() {
  const { command, socket } = await connectToPage();
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Page.navigate", { url: pageUrl });
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return result.result.value;
  }

  const initialTitle = await evaluate("document.querySelector('h1')?.textContent");

  await evaluate(`
    localStorage.removeItem('artihubs_demo_accounts');
    localStorage.removeItem('artihubs_demo_session');
    sessionStorage.removeItem('artihubs_server_access_token');
    document.querySelector('#account-display-name').value = 'Demo Maker';
    document.querySelector('#account-email').value = 'demo-maker@example.com';
    document.querySelector('#account-password').value = 'password123';
    document.querySelector('#account-auth-form').requestSubmit();
  `);
  await new Promise((resolve) => setTimeout(resolve, 1_200));

  const signupStatus = await evaluate("document.querySelector('#account-form-status')?.textContent");
  const signedInTitle = await evaluate("document.querySelector('#session-title')?.textContent");
  const sessionDetails = await evaluate("Array.from(document.querySelectorAll('#account-session-details strong')).map((el) => el.textContent).join(' | ')");
  const storedAccounts = await evaluate("localStorage.getItem('artihubs_demo_accounts') || ''");
  const containsRawEmail = await evaluate("(localStorage.getItem('artihubs_demo_accounts') || '').includes('demo-maker@example.com')");

  await evaluate("document.querySelector('#sign-out').click()");
  await new Promise((resolve) => setTimeout(resolve, 300));

  await evaluate(`
    document.querySelector('[data-auth-mode=login]').click();
    document.querySelector('#account-email').value = 'demo-maker@example.com';
    document.querySelector('#account-password').value = 'password123';
    document.querySelector('#account-auth-form').requestSubmit();
  `);
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  const loginStatus = await evaluate("document.querySelector('#account-form-status')?.textContent");
  const loginTitle = await evaluate("document.querySelector('#session-title')?.textContent");

  await evaluate("document.querySelector('#check-server-auth').click()");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const serverBoundaryStatus = await evaluate("document.querySelector('#server-auth-status')?.textContent");

  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  socket.close();

  const passed =
    initialTitle?.includes("Test signup") &&
    signupStatus?.includes("Local demo account created") &&
    signedInTitle === "Demo Maker" &&
    loginStatus?.includes("Local demo login complete") &&
    loginTitle === "Demo Maker" &&
    containsRawEmail === false;

  const payload = {
    ok: passed,
    initialTitle,
    signupStatus,
    signedInTitle,
    sessionDetails,
    localStorageRawEmailExposed: containsRawEmail,
    storedAccountLength: storedAccounts.length,
    loginStatus,
    loginTitle,
    serverBoundaryStatus,
    screenshotPath
  };

  console.log(JSON.stringify(payload, null, 2));
  if (!passed) process.exit(1);
}

await main();
