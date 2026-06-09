(function () {
  const accountsKey = "artihubs_demo_accounts";
  const sessionKey = "artihubs_demo_session";
  const serverTokenKey = "artihubs_server_access_token";
  const form = document.querySelector("#account-auth-form");
  const status = document.querySelector("#account-form-status");
  const serverStatus = document.querySelector("#server-auth-status");
  const sessionTitle = document.querySelector("#session-title");
  const sessionDetails = document.querySelector("#account-session-details");
  const profileState = document.querySelector("#profile-state");
  const makerState = document.querySelector("#maker-state");
  const submitButton = document.querySelector("#account-submit");
  const displayNameField = document.querySelector("#display-name-field");
  let authMode = "signup";

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

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function displayNameFrom(email) {
    return email.split("@")[0].replace(/[-_.]+/g, " ").trim() || "Artihubs Member";
  }

  function marker(email) {
    return email.includes("@") ? email.split("@").pop().slice(0, 80) : "demo";
  }

  function maskEmail(email) {
    const [name, domain] = email.split("@");
    if (!domain) return "demo account";
    return `${name.slice(0, 1) || "a"}***@${domain}`;
  }

  async function emailFingerprint(email) {
    if (!window.crypto?.subtle) return `fallback_${email.length}_${marker(email)}`;
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

  function renderDetails(session) {
    if (!session) {
      sessionTitle.textContent = "Signed out";
      sessionDetails.innerHTML = `
        <div><span>Mode</span><strong>None</strong></div>
        <div><span>Email</span><strong>-</strong></div>
        <div><span>Public listing</span><strong>Not active</strong></div>
      `;
      profileState.textContent = "No private profile loaded";
      makerState.textContent = "Draft is not public";
      return;
    }

    sessionTitle.textContent = session.displayName || "Artihubs Member";
    sessionDetails.innerHTML = `
      <div><span>Mode</span><strong>${session.mode === "server" ? "Server Auth" : "Local demo"}</strong></div>
      <div><span>Email</span><strong>${session.emailDisplay || session.email}</strong></div>
      <div><span>Public listing</span><strong>Not active</strong></div>
    `;
    profileState.textContent = session.mode === "server" ? "Server session token present" : "Local demo profile active";
    makerState.textContent = "Private draft state only";
  }

  function currentSession() {
    const demoSession = readJson(sessionKey, null);
    if (demoSession?.emailDisplay) return demoSession;

    const serverToken = sessionStorage.getItem(serverTokenKey);
    if (serverToken) {
      return {
        mode: "server",
        email: "Server token session",
        displayName: "Server Auth session"
      };
    }

    return null;
  }

  function setMode(nextMode) {
    authMode = nextMode;
    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
      const active = button.dataset.authMode === authMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    displayNameField.hidden = authMode !== "signup";
    submitButton.textContent = authMode === "signup" ? "Create account" : "Log in";
    document.querySelector("#account-password").autocomplete = authMode === "signup" ? "new-password" : "current-password";
    status.textContent = "";
  }

  async function localSignup({ email, displayName, password }) {
    const accounts = readJson(accountsKey, []);
    const emailHash = await emailFingerprint(email);
    const existingIndex = accounts.findIndex((account) => account.emailHash === emailHash);
    const passwordSalt = existingIndex >= 0 ? accounts[existingIndex].passwordSalt || randomSalt() : randomSalt();
    const account = {
      id: `demo_${Date.now().toString(36)}`,
      emailHash,
      emailDisplay: maskEmail(email),
      emailDomain: marker(email),
      displayName: displayName || displayNameFrom(email),
      passwordSalt,
      passwordHash: await passwordVerifier(password, passwordSalt),
      createdAt: new Date().toISOString(),
      demoOnly: true
    };

    if (existingIndex >= 0) {
      accounts[existingIndex] = { ...accounts[existingIndex], ...account, id: accounts[existingIndex].id };
    } else {
      accounts.push(account);
    }

    writeJson(accountsKey, accounts.slice(-20));
    const session = {
      mode: "demo",
      id: account.id,
      emailDisplay: account.emailDisplay,
      displayName: account.displayName,
      startedAt: new Date().toISOString()
    };
    writeJson(sessionKey, session);
    sessionStorage.removeItem(serverTokenKey);
    return session;
  }

  async function localLogin({ email, password }) {
    const accounts = readJson(accountsKey, []);
    const emailHash = await emailFingerprint(email);
    const account = accounts.find((item) => item.emailHash === emailHash);
    if (!account) throw new Error("No local demo account exists for this email.");
    if (!account.passwordSalt || !account.passwordHash) throw new Error("This local demo account must be recreated before login.");
    const attemptedHash = await passwordVerifier(password, account.passwordSalt);
    if (attemptedHash !== account.passwordHash) throw new Error("Email or password is incorrect for this local demo account.");

    const session = {
      mode: "demo",
      id: account.id,
      emailDisplay: account.emailDisplay,
      displayName: account.displayName,
      startedAt: new Date().toISOString()
    };
    writeJson(sessionKey, session);
    sessionStorage.removeItem(serverTokenKey);
    return session;
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

  async function serverSignup(payload) {
    const body = await postAuth("/api/v1/auth/signup", payload);
    const session = body.data?.session;
    if (session?.accessToken) {
      sessionStorage.setItem(serverTokenKey, session.accessToken);
      localStorage.removeItem(sessionKey);
      return {
        mode: "server",
        email: body.data?.user?.email || payload.email,
        displayName: payload.displayName || displayNameFrom(payload.email),
        startedAt: new Date().toISOString()
      };
    }
    return null;
  }

  async function serverLogin(payload) {
    const body = await postAuth("/api/v1/auth/login", payload);
    const token = body.data?.session?.accessToken;
    if (!token) throw new Error("Server did not issue a usable session.");
    sessionStorage.setItem(serverTokenKey, token);
    localStorage.removeItem(sessionKey);
    return {
      mode: "server",
      email: body.data?.user?.email || payload.email,
      displayName: payload.displayName || displayNameFrom(payload.email),
      startedAt: new Date().toISOString()
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      displayName: String(formData.get("displayName") || "").trim(),
      email: normalizeEmail(formData.get("email")),
      password: String(formData.get("password") || "")
    };

    status.textContent = authMode === "signup" ? "Creating account..." : "Logging in...";
    submitButton.disabled = true;

    try {
      let session = null;
      try {
        session = authMode === "signup" ? await serverSignup(payload) : await serverLogin(payload);
      } catch (serverError) {
        const staticServerFallback = serverError.code === "AUTH_FAILED" && [404, 501].includes(serverError.status);
        if (!["AUTH_NOT_CONFIGURED", "AUTH_PROVIDER_UNAVAILABLE"].includes(serverError.code) && !staticServerFallback) {
          throw serverError;
        }
      }

      if (!session) {
        session = authMode === "signup" ? await localSignup(payload) : await localLogin(payload);
        status.textContent = authMode === "signup"
          ? "Local demo account created. Password was checked but not stored in browser storage."
          : "Local demo login complete.";
      } else {
        status.textContent = authMode === "signup" ? "Server signup accepted." : "Server login complete.";
      }

      renderDetails(session);
      form.reset();
    } catch (error) {
      status.textContent = error.message || "Authentication demo failed.";
    } finally {
      submitButton.disabled = false;
    }
  }

  async function checkServerAuth() {
    const token = sessionStorage.getItem(serverTokenKey);
    serverStatus.textContent = "Checking server auth...";

    try {
      const response = await fetch("/api/v1/me", {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const body = await response.json().catch(() => ({}));
      const code = body.error?.code || (response.ok ? "OK" : "UNKNOWN");
      if (response.ok) {
        serverStatus.textContent = `Server auth ok. Roles: ${(body.data?.roles || []).join(", ") || "none"}.`;
        return;
      }
      serverStatus.textContent = `Server auth status: ${code}. Local demo session remains available.`;
    } catch (error) {
      serverStatus.textContent = "Server auth API is not reachable from this preview. Local demo session remains available.";
    }
  }

  function signOut() {
    localStorage.removeItem(sessionKey);
    sessionStorage.removeItem(serverTokenKey);
    renderDetails(null);
    status.textContent = "Signed out.";
    serverStatus.textContent = "";
  }

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.authMode));
  });
  form.addEventListener("submit", handleSubmit);
  document.querySelector("#check-server-auth").addEventListener("click", checkServerAuth);
  document.querySelector("#sign-out").addEventListener("click", signOut);

  setMode("signup");
  renderDetails(currentSession());
})();
