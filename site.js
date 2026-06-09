(function () {
  const storageKey = "artihubs_prototype_intake";
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
      script.onerror = () => reject(new Error("Turnstile could not be loaded."));
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

  async function submitIntake(payload) {
    const response = await fetch("/api/v1/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("Remote intake is not available yet.");
    }

    return response.json();
  }

  document.querySelectorAll("[data-intake-form]").forEach((form) => {
    const status = form.querySelector("[data-form-status]");
    attachTurnstile(form);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = collectFormData(form);
      if (status) status.textContent = "Submitting...";

      try {
        await submitIntake(payload);
        if (status) status.textContent = "Received. Artihubs will follow up from hello@artihubs.com.";
        form.reset();
      } catch (error) {
        if (isLocalPreview()) {
          const saved = saveLocal(payload);
          if (status) {
            status.textContent =
              saved
                ? "Prototype saved locally. Production deployment will store this in the Artihubs intake database."
                : "Local prototype storage is unavailable. Please try again later.";
          }
          return;
        }

        if (status) status.textContent = "Artihubs intake is temporarily unavailable. Please try again later.";
      }
    });
  });
})();
