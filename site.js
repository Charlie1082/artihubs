(function () {
  const storageKey = "artihubs_prototype_intake";
  const isKoreanMode = document.documentElement.lang === "ko" || window.location.pathname.startsWith("/ko/");
  const t = (en, ko) => (isKoreanMode ? ko : en);
  const turnstileSiteKey = document.querySelector('meta[name="turnstile-site-key"]')?.content?.trim();
  let turnstileScriptPromise = null;

  function loadTurnstileScript() {
    if (!turnstileSiteKey) return Promise.resolve(false);
    if (window.turnstile) return Promise.resolve(true);
    if (turnstileScriptPromise) return turnstileScriptPromise;

    turnstileScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error(t("Turnstile could not be loaded.", "Turnstile을 불러올 수 없습니다.")));
      document.head.appendChild(script);
    });

    return turnstileScriptPromise;
  }

  async function attachTurnstile(form) {
    if (!turnstileSiteKey) return;
    const host = document.createElement("div");
    host.className = "turnstile-field";
    form.dataset.turnstileToken = "";

    const button = form.querySelector('button[type="submit"]');
    if (button) {
      button.insertAdjacentElement("beforebegin", host);
    } else {
      form.appendChild(host);
    }

    try {
      await loadTurnstileScript();
      if (!window.turnstile) return;
      window.turnstile.render(host, {
        sitekey: turnstileSiteKey,
        callback(token) {
          form.dataset.turnstileToken = token;
        },
        "expired-callback"() {
          form.dataset.turnstileToken = "";
        },
        "error-callback"() {
          form.dataset.turnstileToken = "";
        }
      });
    } catch (error) {
      form.dataset.turnstileToken = "";
    }
  }

  function collectFormData(form) {
    const formData = new FormData(form);
    const payload = {
      type: form.dataset.intakeType || "general",
      sourcePath: window.location.pathname,
      metadata: {
        userAgent: navigator.userAgent,
        submittedAt: new Date().toISOString()
      }
    };

    for (const [key, value] of formData.entries()) {
      payload[key] = String(value).trim();
    }

    if (form.dataset.turnstileToken) {
      payload.turnstileToken = form.dataset.turnstileToken;
    }

    return payload;
  }

  function localPreviewPayload(payload) {
    const email = String(payload.email || "").trim();
    const emailDomain = email.includes("@") ? email.split("@").pop().slice(0, 80) : "";
    return {
      type: payload.type || "general",
      sourcePath: payload.sourcePath || window.location.pathname,
      country: payload.country || "",
      region: payload.region || "",
      field: payload.field || "",
      emailDomain,
      messageLength: String(payload.message || "").length,
      submittedAt: payload.metadata?.submittedAt || new Date().toISOString(),
      redacted: true
    };
  }

  function saveLocal(payload) {
    try {
      const existing = JSON.parse(localStorage.getItem(storageKey) || "[]");
      existing.push(localPreviewPayload(payload));
      localStorage.setItem(storageKey, JSON.stringify(existing.slice(-50)));
      return true;
    } catch (error) {
      return false;
    }
  }

  function isLocalPreview() {
    return ["", "localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
  }

  function initHomeSignalSequence() {
    const slots = document.querySelectorAll("[data-home-signal]");
    if (!slots.length) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    slots.forEach((slot) => {
      const message = slot.querySelector("[data-signal-message]");
      const checkButton = slot.querySelector("[data-signal-check]");
      const openLink = slot.querySelector("[data-signal-open]");
      if (!message || !checkButton || !openLink) return;

      const timers = [];
      const scanning = slot.dataset.scanning || "Scanning signal...";
      const detected = slot.dataset.detected || "New capability detected.";
      const checkLabel = slot.dataset.checkLabel || "Check signal";
      const openLabel = slot.dataset.openLabel || "Open Living Globe";
      const openUrl = slot.dataset.openUrl || "./living-globe-v2/";

      checkButton.textContent = checkLabel;
      openLink.textContent = openLabel;
      openLink.href = openUrl;

      function clearTimers() {
        while (timers.length) window.clearTimeout(timers.pop());
      }

      function setSlotState(state, text) {
        slot.classList.remove("is-scanning", "is-fading", "is-detected", "is-open-ready");
        if (state) slot.classList.add(state);
        message.textContent = text || "";
      }

      function revealDetected() {
        setSlotState("is-detected", detected);
      }

      checkButton.addEventListener("click", () => {
        slot.classList.add("is-open-ready");
        openLink.hidden = false;
      });

      if (reduceMotion) {
        revealDetected();
        checkButton.hidden = false;
        return;
      }

      timers.push(window.setTimeout(() => {
        setSlotState("is-scanning", scanning);
      }, 10000));

      timers.push(window.setTimeout(() => {
        slot.classList.add("is-fading");
        timers.push(window.setTimeout(revealDetected, 400));
      }, 16000));

      timers.push(window.setTimeout(() => {
        checkButton.hidden = false;
      }, 20000));

      window.addEventListener("pagehide", clearTimers, { once: true });
      window.addEventListener("beforeunload", clearTimers, { once: true });
    });
  }

  async function submitIntake(payload) {
    const response = await fetch("/api/v1/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(t("Remote intake is not available yet.", "원격 접수는 아직 사용할 수 없습니다."));
    }

    return response.json();
  }

  initHomeSignalSequence();

  document.querySelectorAll("[data-intake-form]").forEach((form) => {
    const status = form.querySelector("[data-form-status]");
    attachTurnstile(form);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = collectFormData(form);
      if (status) status.textContent = t("Submitting...", "제출 중...");

      try {
        await submitIntake(payload);
        if (status) {
          status.textContent = t(
            "Received. Artihubs will follow up through Contact Support.",
            "접수되었습니다. Artihubs가 Contact Support 경로로 연락드립니다."
          );
        }
        form.reset();
      } catch (error) {
        if (isLocalPreview()) {
          const saved = saveLocal(payload);
          if (status) {
            status.textContent =
              saved
                ? t(
                  "Prototype saved locally. Production deployment will store this in the Artihubs intake database.",
                  "프로토타입 항목이 로컬에 저장되었습니다. 프로덕션 배포에서는 Artihubs 접수 데이터베이스에 저장됩니다."
                )
                : t(
                  "Local prototype storage is unavailable. Please try again later.",
                  "로컬 프로토타입 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
                );
          }
          return;
        }

        if (status) {
          status.textContent = t(
            "Artihubs intake is temporarily unavailable. Please try again later.",
            "Artihubs 접수가 일시적으로 중단되었습니다. 잠시 후 다시 시도해 주세요."
          );
        }
      }
    });
  });
})();
