(function () {
  const accountsKey = "artihubs_demo_accounts";
  const sessionKey = "artihubs_demo_session";
  const serverTokenKey = "artihubs_server_access_token";
  const validIntents = new Set(["maker", "seeker"]);
  const isKoreanMode = document.documentElement.lang === "ko" || window.location.pathname.startsWith("/ko/");
  const t = (en, ko) => (isKoreanMode ? ko : en);

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function displayNameFrom(email) {
    return email.split("@")[0].replace(/[-_.]+/g, " ").trim() || t("Artihubs Member", "Artihubs 회원");
  }

  function emailDomain(email) {
    return email.includes("@") ? email.split("@").pop().slice(0, 80) : "demo";
  }

  function maskEmail(email) {
    const [name, domain] = email.split("@");
    if (!domain) return t("demo account", "데모 계정");
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
      setStatus(status, t("Enter a valid email address.", "올바른 이메일 주소를 입력하세요."));
      return false;
    }

    if (payload.password.length < 8) {
      setStatus(status, t("Password must be at least 8 characters.", "비밀번호는 8자 이상이어야 합니다."));
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
      const error = new Error(body.error?.message || t("Authentication request failed.", "인증 요청을 완료할 수 없습니다."));
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
    if (!account) throw new Error(t("No local demo account exists for this email.", "이 이메일로 만든 로컬 데모 계정이 없습니다."));
    if (!account.passwordSalt || !account.passwordHash) throw new Error(t("This local demo account must be recreated before login.", "로그인 전에 이 로컬 데모 계정을 다시 만들어야 합니다."));
    const attemptedHash = await passwordVerifier(payload.password, account.passwordSalt);
    if (attemptedHash !== account.passwordHash) throw new Error(t("Email or password is incorrect for this local demo account.", "이 로컬 데모 계정의 이메일 또는 비밀번호가 올바르지 않습니다."));
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
    if (!token) throw new Error(t("Server did not issue a usable session.", "서버에서 사용할 수 있는 세션이 발급되지 않았습니다."));
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
    const target = new URL(isKoreanMode ? "/ko/welcome/" : "/welcome/", window.location.origin);
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
      setStatus(status, t("Creating private account...", "비공개 계정을 만드는 중..."));

      try {
        let session = null;
        try {
          session = await serverSignup(payload);
        } catch (error) {
          if (!shouldFallbackToLocal(error)) throw error;
        }

        if (!session) {
          session = await localSignup(payload);
          setStatus(status, t("Demo account created. Profile remains private.", "데모 계정이 생성되었습니다. 프로필은 비공개로 유지됩니다."));
        } else {
          setStatus(status, t("Server account created. Profile remains private.", "서버 계정이 생성되었습니다. 프로필은 비공개로 유지됩니다."));
        }

        window.location.href = welcomeUrl(session.roleIntent);
      } catch (error) {
        setStatus(status, error.message || t("Signup could not be completed.", "가입을 완료할 수 없습니다."));
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
      setStatus(status, t(
        "Password reset email is reserved for the validated transactional email setup.",
        "비밀번호 재설정 이메일은 검증된 발송 설정이 준비된 후 제공될 예정입니다."
      ));
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
      setStatus(status, t("Signing in...", "로그인 중..."));

      try {
        let session = null;
        try {
          session = await serverLogin(payload);
        } catch (error) {
          if (!shouldFallbackToLocal(error)) throw error;
        }

        if (!session) {
          session = await localLogin(payload);
          setStatus(status, t("Demo login complete.", "데모 로그인이 완료되었습니다."));
        } else {
          setStatus(status, t("Server login complete.", "서버 로그인이 완료되었습니다."));
        }

        window.location.href = welcomeUrl(session.roleIntent);
      } catch (error) {
        setStatus(status, error.message || t("Login could not be completed.", "로그인을 완료할 수 없습니다."));
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
    const displayName = session?.displayName || (token ? t("Artihubs member", "Artihubs 회원") : t("Guest", "게스트"));
    const signedIn = Boolean(session?.displayName || token);

    document.querySelector("[data-welcome-name]").textContent = signedIn
      ? displayName
      : t("Welcome to Artihubs", "Artihubs에 오신 것을 환영합니다.");
    document.querySelector("[data-welcome-status]").textContent = signedIn
      ? t(
        "Your profile is private until reviewed and approved for publication.",
        "프로필은 검토와 공개 승인 전까지 비공개입니다."
      )
      : t(
        "Create an account or sign in to open your private workspace.",
        "계정을 만들거나 로그인하여 비공개 워크스페이스를 여세요."
      );

    document.querySelectorAll("[data-task-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.taskPanel === intent);
    });

    const signOut = document.querySelector("[data-welcome-signout]");
    signOut?.addEventListener("click", () => {
      localStorage.removeItem(sessionKey);
      sessionStorage.removeItem(serverTokenKey);
      window.location.href = isKoreanMode ? "/ko/login/" : "/login/";
    });
  }

  bindSignup();
  bindLogin();
  bindWelcome();
})();
