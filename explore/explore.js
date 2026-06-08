let currentMatches = [];
let currentView = "cards";

const form = document.querySelector("#ai-search-form");
const searchInput = document.querySelector("#ai-search-input");
const clearButton = document.querySelector("#clear-search");
const grid = document.querySelector("#maker-grid");
const emptyState = document.querySelector("#empty-state");
const searchStatus = document.querySelector("#search-status");
const searchSummary = document.querySelector("#search-summary");
const searchHeading = document.querySelector("#search-heading");
const introField = document.querySelector("#intro-field");
const tabButtons = document.querySelectorAll("[data-tab-target]");
const viewButtons = document.querySelectorAll("[data-view]");
const suggestionButtons = document.querySelectorAll(".query-suggestions button");

function markerFor(maker) {
  return maker.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function renderMatchCard(maker) {
  const relevance = maker.relevance ? `${Math.round(maker.relevance * 100)}% match` : "Prototype profile";
  const sourceLabel = "Claude ranked";
  return `
    <article class="maker-card">
      <header>
        <div>
          <p class="eyebrow">${maker.country} / ${maker.region}</p>
          <h3>${maker.name}</h3>
        </div>
        <div class="avatar-mark">${markerFor(maker)}</div>
      </header>
      <p class="match-score"><span>${sourceLabel}</span><strong>${relevance}</strong></p>
      <p><strong>${maker.capability}</strong></p>
      <p>${maker.summary}</p>
      <p class="match-reason">${maker.reason || relevance}</p>
      <div class="tag-row">
        ${(maker.tags || []).map((tag) => `<span class="tag">${tag}</span>`).join("")}
      </div>
      <button class="button secondary" type="button" data-intro="${maker.name} - ${maker.capability}">Ask about this maker</button>
    </article>
  `;
}

function renderMatchRow(maker) {
  const relevance = maker.relevance ? `${Math.round(maker.relevance * 100)}%` : "profile";
  const sourceLabel = "Claude ranked";
  return `
    <article class="maker-row">
      <div class="avatar-mark">${markerFor(maker)}</div>
      <div>
        <p class="eyebrow">${maker.country} / ${maker.region} · ${sourceLabel} · ${relevance}</p>
        <h3>${maker.name}</h3>
        <p><strong>${maker.capability}</strong> · ${maker.summary}</p>
        <p class="match-reason">${maker.reason || "Current Artihubs prototype profile."}</p>
      </div>
      <button class="button secondary" type="button" data-intro="${maker.name} - ${maker.capability}">Ask</button>
    </article>
  `;
}

function renderMatches(matches, summary = "Ask in natural language, or browse the current prototype maker set.") {
  currentMatches = matches;
  grid.classList.toggle("is-list-view", currentView === "list");
  grid.innerHTML = matches.map((maker) => (currentView === "list" ? renderMatchRow(maker) : renderMatchCard(maker))).join("");
  emptyState.classList.toggle("is-visible", matches.length === 0);
  searchHeading.textContent = matches.length ? `${matches.length} Artihubs match${matches.length === 1 ? "" : "es"}` : "No matches yet";
  searchSummary.textContent = summary;
}

async function searchMakers(query) {
  if (searchStatus) searchStatus.textContent = query ? "Searching with Claude Sonnet 4.6..." : "";

  try {
    const response = await fetch("../api/search/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "Claude Sonnet 4.6 search is unavailable.");
    }
    renderMatches(data.matches || [], data.summary);
    if (searchStatus) {
      searchStatus.textContent = query
        ? "Claude Sonnet 4.6 ranked these makers for your request."
        : "Claude-only dry test mode is ready.";
    }
  } catch (error) {
    renderMatches([], error.message);
    if (searchStatus) searchStatus.textContent = "Claude-only search failed. No local fallback was used.";
  }
}

function switchTab(targetId) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === targetId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const isActive = panel.id === targetId;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });

  history.replaceState(null, "", targetId === "ask-panel" ? "#ask" : "#search");
}

function applyUrlContext() {
  const params = new URLSearchParams(window.location.search);
  const parts = [params.get("field"), params.get("region"), params.get("country")].filter(Boolean);
  if (parts.length) {
    searchInput.value = `Find makers for ${parts.join(" in ")}.`;
  }
}

async function init() {
  applyUrlContext();
  await searchMakers(searchInput.value.trim());
  if (window.location.hash === "#ask") switchTab("ask-panel");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await searchMakers(searchInput.value.trim());
});

clearButton.addEventListener("click", async () => {
  searchInput.value = "";
  await searchMakers("");
});

suggestionButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    searchInput.value = button.textContent;
    await searchMakers(searchInput.value.trim());
  });
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tabTarget));
});

viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentView = button.dataset.view;
    viewButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    renderMatches(currentMatches, searchSummary.textContent);
  });
});

grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-intro]");
  if (!button || !introField) return;
  introField.value = button.dataset.intro;
  switchTab("ask-panel");
  introField.scrollIntoView({ block: "center", behavior: "smooth" });
});

init().catch((error) => {
  console.error(error);
  if (searchStatus) searchStatus.textContent = "Maker data could not be loaded.";
});
