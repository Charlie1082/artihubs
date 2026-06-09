(function () {
  const accountsKey = "artihubs_demo_accounts";
  const sessionKey = "artihubs_demo_session";
  const serverTokenKey = "artihubs_server_access_token";
  const validIntents = new Set(["maker", "seeker"]);

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function displayNameFrom(email) {
    return email.split("@")[0].replace(/[-_.]+/g, " ").trim() || "Artihubs Member";
  }

  function emailDomain(email) {
    return email.includes("@") ? email.split("@").pop().slice(0, 80) : "demo";
  }

  function maskEmail(email) {
    const [name, domain] = email.split("@");
    if (!domain) return "demo account";
    return `${name.slice(0, 1) || "a"}***@${domain}`;
  }

  async function emailFingerprint(email) {
    if (!window.crypto?.subtle) return `fallback_${email.length}_${emailDomain(email)}`;
    const bytes = new TextEncoder().encode(email);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function randomSalt() {
    if (!window.crypto?.getRandomValues) return `fallback_${Date.now().toString(36)}`;
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function passwordVerifier(password, salt) {
    if (!window.crypto?.subtle) return `fallback_${salt}_${String(password).length}`;
    const bytes = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function currentIntent(form) {
    const selected = form?.querySelector('input[name="roleIntent"]:checked')?.value || "maker";
    return validIntents.has(selected) ? selected : "maker";
  }

  function setStatus(element, message) {
    if (element) element.textContent = message;
  }

  function setSubmitState(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }

  function validateAuthPayload(payload, status) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      setStatus(status, "Enter a valid email address.");
      return false;
    }

    if (payload.password.length < 8) {
      setStatus(status, "Password must be at least 8 characters.");
      return false;
    }

    return true;
  }

  async function postAuth(pathname, payload) {
    const response = await fetch(pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message || "Authentication request failed.");
      error.code = body.error?.code || "AUTH_FAILED";
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function shouldFallbackToLocal(error) {
    if (["AUTH_NOT_CONFIGURED", "AUTH_PROVIDER_UNAVAILABLE"].includes(error.code)) return true;
    return error.code === "AUTH_FAILED" && [404, 501].includes(error.status);
  }

  async function localSignup(payload) {
    const accounts = readJson(accountsKey, []);
    const emailHash = await emailFingerprint(payload.email);
    const existingIndex = accounts.findIndex((account) => account.emailHash === emailHash);
    const passwordSalt = existingIndex >= 0 ? accounts[existingIndex].passwordSalt || randomSalt() : randomSalt();
    const account = {
      id: existingIndex >= 0 ? accounts[existingIndex].id : `demo_${Date.now().toString(36)}`,
      emailHash,
      emailDisplay: maskEmail(payload.email),
      emailDomain: emailDomain(payload.email),
      displayName: payload.displayName || displayNameFrom(payload.email),
      roleIntent: payload.roleIntent,
      passwordSalt,
      passwordHash: await passwordVerifier(payload.password, passwordSalt),
      createdAt: existingIndex >= 0 ? accounts[existingIndex].createdAt : new Date().toISOString(),
      demoOnly: true
    };

    if (existingIndex >= 0) accounts[existingIndex] = account;
    else accounts.push(account);

    writeJson(accountsKey, accounts.slice(-20));
    return openDemoSession(account);
  }

  async function localLogin(payload) {
    const emailHash = await emailFingerprint(payload.email);
    const account = readJson(accountsKey, []).find((item) => item.emailHash === emailHash);
    if (!account) throw new Error("No local demo account exists for this email.");
    if (!account.passwordSalt || !account.passwordHash) throw new Error("This local demo account must be recreated before login.");
    const attemptedHash = await passwordVerifier(payload.password, account.passwordSalt);
    if (attemptedHash !== account.passwordHash) throw new Error("Email or password is incorrect for this local demo account.");
    return openDemoSession(account);
  }

  function openDemoSession(account) {
    const session = {
      mode: "demo",
      id: account.id,
      emailDisplay: account.emailDisplay,
      displayName: account.displayName,
      roleIntent: validIntents.has(account.roleIntent) ? account.roleIntent : "maker",
      profileStatus: "private",
      reviewStatus: "not_submitted",
      startedAt: new Date().toISOString()
    };
    writeJson(sessionKey, session);
    sessionStorage.removeItem(serverTokenKey);
    return session;
  }

  async function serverSignup(payload) {
    const body = await postAuth("/api/v1/auth/signup", payload);
    const session = body.data?.session;
    if (!session?.accessToken) return null;
    sessionStorage.setItem(serverTokenKey, session.accessToken);
    localStorage.removeItem(sessionKey);
    return {
      mode: "server",
      displayName: payload.displayName || displayNameFrom(payload.email),
      emailDisplay: maskEmail(body.data?.user?.email || payload.email),
      roleIntent: payload.roleIntent,
      profileStatus: "private"
    };
  }

  async function serverLogin(payload) {
    const body = await postAuth("/api/v1/auth/login", payload);
    const token = body.data?.session?.accessToken;
    if (!token) throw new Error("Server did not issue a usable session.");
    sessionStorage.setItem(serverTokenKey, token);
    localStorage.removeItem(sessionKey);
    return {
      mode: "server",
      displayName: payload.displayName || displayNameFrom(payload.email),
      emailDisplay: maskEmail(body.data?.user?.email || payload.email),
      roleIntent: payload.roleIntent || "maker",
      profileStatus: "private"
    };
  }

  function welcomeUrl(intent) {
    const target = new URL("/welcome/", window.location.origin);
    target.searchParams.set("intent", validIntents.has(intent) ? intent : "maker");
    return target.toString();
  }

  function bindSignup() {
    const form = document.querySelector("[data-signup-form]");
    if (!form) return;
    const status = document.querySelector("[data-auth-status]");
    const submit = form.querySelector('button[type="submit"]');

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const payload = {
        displayName: String(formData.get("displayName") || "").trim().slice(0, 120),
        email: normalizeEmail(formData.get("email")),
        password: String(formData.get("password") || ""),
        roleIntent: currentIntent(form)
      };

      if (!validateAuthPayload(payload, status)) return;

      setSubmitState(submit, true);
      setStatus(status, "Creating private account...");

      try {
        let session = null;
        try {
          session = await serverSignup(payload);
        } catch (error) {
          if (!shouldFallbackToLocal(error)) throw error;
        }

        if (!session) {
          session = await localSignup(payload);
          setStatus(status, "Demo account created. Profile remains private.");
        } else {
          setStatus(status, "Server account created. Profile remains private.");
        }

        window.location.href = welcomeUrl(session.roleIntent);
      } catch (error) {
        setStatus(status, error.message || "Signup could not be completed.");
      } finally {
        setSubmitState(submit, false);
      }
    });
  }

  function bindLogin() {
    const form = document.querySelector("[data-login-form]");
    if (!form) return;
    const status = document.querySelector("[data-auth-status]");
    const submit = form.querySelector('button[type="submit"]');
    const forgot = document.querySelector("[data-forgot-password]");

    forgot?.addEventListener("click", () => {
      setStatus(status, "Password reset email is reserved for the validated transactional email setup.");
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const payload = {
        email: normalizeEmail(formData.get("email")),
        password: String(formData.get("password") || "")
      };

      if (!validateAuthPayload({ ...payload, displayName: "" }, status)) return;

      setSubmitState(submit, true);
      setStatus(status, "Signing in...");

      try {
        let session = null;
        try {
          session = await serverLogin(payload);
        } catch (error) {
          if (!shouldFallbackToLocal(error)) throw error;
        }

        if (!session) {
          session = await localLogin(payload);
          setStatus(status, "Demo login complete.");
        } else {
          setStatus(status, "Server login complete.");
        }

        window.location.href = welcomeUrl(session.roleIntent);
      } catch (error) {
        setStatus(status, error.message || "Login could not be completed.");
      } finally {
        setSubmitState(submit, false);
      }
    });
  }

  function bindWelcome() {
    const shell = document.querySelector("[data-welcome]");
    if (!shell) return;
    const session = readJson(sessionKey, null);
    const token = sessionStorage.getItem(serverTokenKey);
    const params = new URLSearchParams(window.location.search);
    const intent = validIntents.has(params.get("intent")) ? params.get("intent") : session?.roleIntent || "maker";
    const displayName = session?.displayName || (token ? "Artihubs member" : "Guest");
    const signedIn = Boolean(session?.displayName || token);

    document.querySelector("[data-welcome-name]").textContent = signedIn ? displayName : "Welcome to Artihubs";
    document.querySelector("[data-welcome-status]").textContent = signedIn
      ? "Your profile is private until reviewed and approved for publication."
      : "Create an account or sign in to open your private workspace.";

    document.querySelectorAll("[data-task-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.taskPanel === intent);
    });

    const signOut = document.querySelector("[data-welcome-signout]");
    signOut?.addEventListener("click", () => {
      localStorage.removeItem(sessionKey);
      sessionStorage.removeItem(serverTokenKey);
      window.location.href = "/login/";
    });
  }

  bindSignup();
  bindLogin();
  bindWelcome();
})();
