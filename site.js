(function () {
  const storageKey = "artihubs_prototype_intake";

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

    return payload;
  }

  function saveLocal(payload) {
    const existing = JSON.parse(localStorage.getItem(storageKey) || "[]");
    existing.push(payload);
    localStorage.setItem(storageKey, JSON.stringify(existing.slice(-50)));
  }

  async function submitIntake(payload) {
    const response = await fetch("/api/intake", {
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

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = collectFormData(form);
      if (status) status.textContent = "Submitting...";

      try {
        await submitIntake(payload);
        if (status) status.textContent = "Received. Artihubs will follow up from hello@artihubs.com.";
        form.reset();
      } catch (error) {
        saveLocal(payload);
        if (status) {
          status.textContent =
            "Prototype saved locally. Production deployment will store this in the Artihubs intake database.";
        }
      }
    });
  });
})();
