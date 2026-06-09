import fs from "node:fs";
import path from "node:path";

const devtoolsUrl = process.argv[2] || "http://127.0.0.1:9223";
const origin = process.argv[3] || "http://127.0.0.1:4173";
const screenshotPath = process.argv[4] || "/private/tmp/artihubs-auth-flow-demo.png";

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

async function main() {
  const { command, socket } = await connectToPage();
  await command("Page.enable");
  await command("Runtime.enable");

  async function wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return result.result.value;
  }

  await command("Page.navigate", { url: `${origin}/signup/?v=auth-flow` });
  await wait(1_000);

  const signupTitle = await evaluate("document.querySelector('h1')?.textContent");
  await evaluate(`
    localStorage.removeItem('artihubs_demo_accounts');
    localStorage.removeItem('artihubs_demo_session');
    sessionStorage.removeItem('artihubs_server_access_token');
    document.querySelector('#signup-name').value = 'Demo Maker';
    document.querySelector('#signup-email').value = 'demo-maker@example.com';
    document.querySelector('#signup-password').value = 'password123';
    document.querySelector('input[name="roleIntent"][value="maker"]').checked = true;
    document.querySelector('[data-signup-form]').requestSubmit();
  `);
  await wait(1_400);

  const afterSignupUrl = await evaluate("window.location.href");
  const welcomeTitle = await evaluate("document.querySelector('h1')?.textContent");
  const welcomeName = await evaluate("document.querySelector('[data-welcome-name]')?.textContent");
  const activePanel = await evaluate("document.querySelector('[data-task-panel].is-active')?.dataset.taskPanel");
  const statusBanner = await evaluate("document.querySelector('[data-welcome-status]')?.textContent");
  const localAccounts = await evaluate("localStorage.getItem('artihubs_demo_accounts') || ''");
  const rawEmailExposed = await evaluate("(localStorage.getItem('artihubs_demo_accounts') || '').includes('demo-maker@example.com')");

  await evaluate("document.querySelector('[data-welcome-signout]').click()");
  await wait(700);

  const afterSignoutUrl = await evaluate("window.location.href");
  await evaluate(`
    document.querySelector('#login-email').value = 'demo-maker@example.com';
    document.querySelector('#login-password').value = 'wrongpass';
    document.querySelector('[data-login-form]').requestSubmit();
  `);
  await wait(800);

  const wrongPasswordStatus = await evaluate("document.querySelector('[data-auth-status]')?.textContent");
  const afterWrongPasswordUrl = await evaluate("window.location.href");

  await evaluate(`
    document.querySelector('#login-password').value = 'password123';
    document.querySelector('[data-login-form]').requestSubmit();
  `);
  await wait(1_200);

  const afterLoginUrl = await evaluate("window.location.href");
  const loginWelcomeName = await evaluate("document.querySelector('[data-welcome-name]')?.textContent");
  const loginActivePanel = await evaluate("document.querySelector('[data-task-panel].is-active')?.dataset.taskPanel");
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  socket.close();

  const passed =
    signupTitle === "Create your Artihubs account." &&
    afterSignupUrl.includes("/welcome/") &&
    welcomeTitle === "Welcome to Artihubs." &&
    welcomeName === "Demo Maker" &&
    activePanel === "maker" &&
    statusBanner.includes("private until reviewed") &&
    rawEmailExposed === false &&
    afterSignoutUrl.includes("/login/") &&
    afterWrongPasswordUrl.includes("/login/") &&
    wrongPasswordStatus.includes("incorrect") &&
    afterLoginUrl.includes("/welcome/") &&
    loginWelcomeName === "Demo Maker" &&
    loginActivePanel === "maker";

  const payload = {
    ok: passed,
    signupTitle,
    afterSignupUrl,
    welcomeTitle,
    welcomeName,
    activePanel,
    statusBanner,
    rawEmailExposed,
    storedAccountLength: localAccounts.length,
    afterSignoutUrl,
    wrongPasswordStatus,
    afterWrongPasswordUrl,
    afterLoginUrl,
    loginWelcomeName,
    loginActivePanel,
    screenshotPath
  };

  console.log(JSON.stringify(payload, null, 2));
  if (!passed) process.exit(1);
}

await main();
