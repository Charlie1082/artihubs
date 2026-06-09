let currentMatches = [];
let currentView = "cards";
let currentSummary = "Ask in natural language, or browse the current prototype maker set.";
let currentSummaryKo = "";
let searchSequence = 0;

const form = document.querySelector("#ai-search-form");
const searchInput = document.querySelector("#ai-search-input");
const clearButton = document.querySelector("#clear-search");
const grid = document.querySelector("#maker-grid");
const emptyState = document.querySelector("#empty-state");
const searchStatus = document.querySelector("#search-status");
const searchSummary = document.querySelector("#search-summary");
const searchSummaryKo = document.querySelector("#search-summary-ko");
const searchHeading = document.querySelector("#search-heading");
const introField = document.querySelector("#intro-field");
const tabButtons = document.querySelectorAll("[data-tab-target]");
const viewButtons = document.querySelectorAll("[data-view]");
const suggestionButtons = document.querySelectorAll(".query-suggestions button");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
  const sourceLabel = "Matched by Artihubs";
  const introValue = escapeHtml(`${maker.name} - ${maker.capability}`);
  const koreanNote = maker.reasonKo
    ? `<p class="match-reason-ko" lang="ko"><span>한국어 참고</span>${escapeHtml(maker.reasonKo)}</p>`
    : "";
  return `
    <article class="maker-card">
      <header>
        <div>
          <p class="eyebrow">${escapeHtml(maker.country)} / ${escapeHtml(maker.region)}</p>
          <h3>${escapeHtml(maker.name)}</h3>
        </div>
        <div class="avatar-mark">${escapeHtml(markerFor(maker))}</div>
      </header>
      <p class="match-score"><span>${sourceLabel}</span><strong>${relevance}</strong></p>
      <p><strong>${escapeHtml(maker.capability)}</strong></p>
      <p>${escapeHtml(maker.summary)}</p>
      <p class="match-reason"><span>AI match note</span>${escapeHtml(maker.reason || relevance)}</p>
      ${koreanNote}
      <div class="tag-row">
        ${(maker.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <button class="button secondary" type="button" data-intro="${introValue}">Ask about this maker</button>
    </article>
  `;
}

function renderMatchRow(maker) {
  const relevance = maker.relevance ? `${Math.round(maker.relevance * 100)}%` : "profile";
  const sourceLabel = "Matched by Artihubs";
  const introValue = escapeHtml(`${maker.name} - ${maker.capability}`);
  const koreanNote = maker.reasonKo
    ? `<p class="match-reason-ko" lang="ko"><span>한국어 참고</span>${escapeHtml(maker.reasonKo)}</p>`
    : "";
  return `
    <article class="maker-row">
      <div class="avatar-mark">${escapeHtml(markerFor(maker))}</div>
      <div>
        <p class="eyebrow">${escapeHtml(maker.country)} / ${escapeHtml(maker.region)} · ${sourceLabel} · ${relevance}</p>
        <h3>${escapeHtml(maker.name)}</h3>
        <p><strong>${escapeHtml(maker.capability)}</strong> · ${escapeHtml(maker.summary)}</p>
        <p class="match-reason"><span>AI match note</span>${escapeHtml(maker.reason || "Claude matched this maker to the request.")}</p>
        ${koreanNote}
      </div>
      <button class="button secondary" type="button" data-intro="${introValue}">Ask</button>
    </article>
  `;
}

function renderMatches(matches, summary = currentSummary, summaryKo = currentSummaryKo) {
  currentMatches = matches;
  currentSummary = summary || "";
  currentSummaryKo = summaryKo || "";
  grid.classList.toggle("is-list-view", currentView === "list");
  grid.innerHTML = matches.map((maker) => (currentView === "list" ? renderMatchRow(maker) : renderMatchCard(maker))).join("");
  emptyState.classList.toggle("is-visible", matches.length === 0);
  searchHeading.textContent = matches.length ? `${matches.length} Artihubs match${matches.length === 1 ? "" : "es"}` : "No matches yet";
  searchSummary.textContent = currentSummary;
  if (searchSummaryKo) {
    searchSummaryKo.textContent = currentSummaryKo;
    searchSummaryKo.hidden = !currentSummaryKo;
  }
}

async function searchMakers(query) {
  const sequence = ++searchSequence;
  if (searchStatus) searchStatus.textContent = query ? "Searching Artihubs..." : "";

  try {
    const response = await fetch("/api/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });

    const data = await response.json().catch(() => ({}));
    if (sequence !== searchSequence) return;
    if (!response.ok || data.ok === false) {
      throw new Error(data.error?.message || data.error || "Artihubs search is temporarily unavailable.");
    }
    renderMatches(data.matches || [], data.summary, data.summaryKo);
    if (searchStatus) {
      searchStatus.textContent = query
        ? data.degraded
          ? "Local prototype ranking is active while AI search is unavailable."
          : "Matched by Artihubs."
        : "Artihubs search is ready.";
    }
  } catch (error) {
    if (sequence !== searchSequence) return;
    renderMatches([], error.message, "");
    if (searchStatus) searchStatus.textContent = "Artihubs could not complete this search.";
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
    renderMatches(currentMatches, currentSummary, currentSummaryKo);
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
