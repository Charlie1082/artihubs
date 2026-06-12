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
  const isKoreanMode = document.documentElement.lang === "ko" || window.location.pathname.startsWith("/ko/");
  const t = (en, ko) => (isKoreanMode ? ko : en);
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
    return email.split("@")[0].replace(/[-_.]+/g, " ").trim() || t("Artihubs Member", "Artihubs 회원");
  }

  function marker(email) {
    return email.includes("@") ? email.split("@").pop().slice(0, 80) : "demo";
  }

  function maskEmail(email) {
    const [name, domain] = email.split("@");
    if (!domain) return t("demo account", "데모 계정");
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
    const modeLabel = t("Mode", "모드");
    const emailLabel = t("Email", "이메일");
    const listingLabel = t("Public listing", "공개 등록");
    const notActive = t("Not active", "비활성");

    if (!session) {
      sessionTitle.textContent = t("Signed out", "로그아웃 상태");
      sessionDetails.innerHTML = `
        <div><span>${modeLabel}</span><strong>${t("None", "없음")}</strong></div>
        <div><span>${emailLabel}</span><strong>-</strong></div>
        <div><span>${listingLabel}</span><strong>${notActive}</strong></div>
      `;
      profileState.textContent = t("No private profile loaded", "불러온 비공개 프로필 없음");
      makerState.textContent = t("Draft is not public", "초안은 공개되지 않았습니다.");
      return;
    }

    sessionTitle.textContent = session.displayName || t("Artihubs Member", "Artihubs 회원");
    sessionDetails.innerHTML = `
      <div><span>${modeLabel}</span><strong>${session.mode === "server" ? t("Server Auth", "서버 Auth") : t("Local demo", "로컬 데모")}</strong></div>
      <div><span>${emailLabel}</span><strong>${session.emailDisplay || session.email}</strong></div>
      <div><span>${listingLabel}</span><strong>${notActive}</strong></div>
    `;
    profileState.textContent = session.mode === "server"
      ? t("Server session token present", "서버 세션 토큰이 있습니다.")
      : t("Local demo profile active", "로컬 데모 프로필이 활성화되었습니다.");
    makerState.textContent = t("Private draft state only", "비공개 초안 상태만 유지됩니다.");
  }

  function currentSession() {
    const demoSession = readJson(sessionKey, null);
    if (demoSession?.emailDisplay) return demoSession;

    const serverToken = sessionStorage.getItem(serverTokenKey);
    if (serverToken) {
      return {
        mode: "server",
        email: t("Server token session", "서버 토큰 세션"),
        displayName: t("Server Auth session", "서버 Auth 세션")
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
    submitButton.textContent = authMode === "signup" ? t("Create account", "계정 만들기") : t("Log in", "로그인");
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
    if (!account) throw new Error(t("No local demo account exists for this email.", "이 이메일로 만든 로컬 데모 계정이 없습니다."));
    if (!account.passwordSalt || !account.passwordHash) throw new Error(t("This local demo account must be recreated before login.", "로그인 전에 이 로컬 데모 계정을 다시 만들어야 합니다."));
    const attemptedHash = await passwordVerifier(password, account.passwordSalt);
    if (attemptedHash !== account.passwordHash) throw new Error(t("Email or password is incorrect for this local demo account.", "이 로컬 데모 계정의 이메일 또는 비밀번호가 올바르지 않습니다."));

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
      const error = new Error(body.error?.message || t("Authentication request failed.", "인증 요청을 완료할 수 없습니다."));
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
    if (!token) throw new Error(t("Server did not issue a usable session.", "서버에서 사용할 수 있는 세션이 발급되지 않았습니다."));
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

    status.textContent = authMode === "signup" ? t("Creating account...", "계정을 만드는 중...") : t("Logging in...", "로그인 중...");
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
          ? t(
            "Local demo account created. Password was checked but not stored in browser storage.",
            "로컬 데모 계정이 생성되었습니다. 비밀번호는 확인만 하고 브라우저 저장소에 저장하지 않습니다."
          )
          : t("Local demo login complete.", "로컬 데모 로그인이 완료되었습니다.");
      } else {
        status.textContent = authMode === "signup"
          ? t("Server signup accepted.", "서버 가입이 접수되었습니다.")
          : t("Server login complete.", "서버 로그인이 완료되었습니다.");
      }

      renderDetails(session);
      form.reset();
    } catch (error) {
      status.textContent = error.message || t("Authentication demo failed.", "인증 데모에 실패했습니다.");
    } finally {
      submitButton.disabled = false;
    }
  }

  async function checkServerAuth() {
    const token = sessionStorage.getItem(serverTokenKey);
    serverStatus.textContent = t("Checking server auth...", "서버 Auth 확인 중...");

    try {
      const response = await fetch("/api/v1/me", {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const body = await response.json().catch(() => ({}));
      const code = body.error?.code || (response.ok ? "OK" : "UNKNOWN");
      if (response.ok) {
        const roles = (body.data?.roles || []).join(", ");
        serverStatus.textContent = t(
          `Server auth ok. Roles: ${roles || "none"}.`,
          `서버 Auth 정상. 역할: ${roles || "없음"}.`
        );
        return;
      }
      serverStatus.textContent = t(
        `Server auth status: ${code}. Local demo session remains available.`,
        `서버 Auth 상태: ${code}. 로컬 데모 세션은 계속 사용할 수 있습니다.`
      );
    } catch (error) {
      serverStatus.textContent = t(
        "Server auth API is not reachable from this preview. Local demo session remains available.",
        "이 미리보기에서 서버 Auth API에 연결할 수 없습니다. 로컬 데모 세션은 계속 사용할 수 있습니다."
      );
    }
  }

  function signOut() {
    localStorage.removeItem(sessionKey);
    sessionStorage.removeItem(serverTokenKey);
    renderDetails(null);
    status.textContent = t("Signed out.", "로그아웃되었습니다.");
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
