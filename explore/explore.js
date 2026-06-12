const isKoreanMode = document.documentElement.lang === "ko" || window.location.pathname.startsWith("/ko/");
const t = (en, ko) => (isKoreanMode ? ko : en);

let currentMatches = [];
let currentView = "cards";
let currentSummary = t(
  "Explain the need to AI ARX, or browse registered Maker Tags before starting a Request Tag.",
  "AI ARX(AI 아릭스)에게 필요한 내용을 설명하거나, Request Tag를 시작하기 전에 등록된 Maker Tag를 살펴보세요."
);
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
const arxClarify = document.querySelector("#arx-clarify");
const arxAnalysis = document.querySelector("#arx-analysis");
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
  const relevance = maker.relevance
    ? t("Grounded evidence", "근거 확인됨")
    : t("Registered Maker Tag", "등록된 Maker Tag");
  const sourceLabel = t("Maker Tag.", "Maker Tag.");
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
      <p class="match-reason"><span>${t("ARX evidence note", "ARX 근거 메모")}</span>${escapeHtml(maker.reason || relevance)}</p>
      ${koreanNote}
      <div class="tag-row">
        ${(maker.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <button class="button secondary" type="button" data-intro="${introValue}">${t("Start Request Tag.", "Request Tag. 시작")}</button>
    </article>
  `;
}

function renderMatchRow(maker) {
  const relevance = maker.relevance ? t("grounded", "근거 확인") : t("profile", "프로필");
  const sourceLabel = t("Maker Tag.", "Maker Tag.");
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
        <p class="match-reason"><span>${t("ARX evidence note", "ARX 근거 메모")}</span>${escapeHtml(maker.reason || t("ARX grounded this Maker Tag in the request.", "ARX가 이 Maker Tag를 요청 근거와 연결했습니다."))}</p>
        ${koreanNote}
      </div>
      <button class="button secondary" type="button" data-intro="${introValue}">${t("Request Tag.", "Request Tag.")}</button>
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
  searchHeading.textContent = matches.length
    ? t(`${matches.length} grounded Maker Tag${matches.length === 1 ? "" : "s"}`, `근거 있는 Maker Tag ${matches.length}건`)
    : t("No grounded Maker Tags yet", "아직 근거 있는 Maker Tag가 없습니다");
  searchSummary.textContent = currentSummary;
  if (searchSummaryKo) {
    searchSummaryKo.textContent = currentSummaryKo;
    searchSummaryKo.hidden = !currentSummaryKo;
  }
}

// ARX response extras (clarifying question, need analysis) are optional —
// rendered when the engine provides them, invisible otherwise, so this UI
// stays compatible until the ARX engine schema lands.
function renderArxExtras(data = {}) {
  if (arxClarify) {
    const question = isKoreanMode
      ? data.clarifyingQuestionKo || data.clarifyingQuestion
      : data.clarifyingQuestion;
    arxClarify.hidden = !question;
    arxClarify.textContent = question
      ? `${t("One question before matching:", "매칭 전에 한 가지만 여쭤볼게요:")} ${question}`
      : "";
  }

  if (arxAnalysis) {
    const koItems = Array.isArray(data.analysisKo) ? data.analysisKo : [];
    const enItems = Array.isArray(data.analysis) ? data.analysis : [];
    const items = isKoreanMode ? (koItems.length ? koItems : enItems) : enItems;
    arxAnalysis.hidden = !items.length;
    arxAnalysis.innerHTML = items.length
      ? `<span class="eyebrow">${t("Need analysis", "필요 분석")}</span><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "";
  }
}

async function searchMakers(query) {
  const sequence = ++searchSequence;
  if (searchStatus) searchStatus.textContent = query ? t("ARX is searching registered Maker Tags...", "ARX가 등록된 Maker Tag를 검색하는 중...") : "";

  try {
    const response = await fetch("/api/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });

    const data = await response.json().catch(() => ({}));
    if (sequence !== searchSequence) return;
    if (!response.ok || data.ok === false) {
      throw new Error(data.error?.message || data.error || t("Artihubs search is temporarily unavailable.", "Artihubs 검색이 일시적으로 중단되었습니다."));
    }
    if (isKoreanMode) {
      renderMatches(data.matches || [], data.summaryKo || data.summary, "");
    } else {
      renderMatches(data.matches || [], data.summary, data.summaryKo);
    }
    renderArxExtras(data);
    if (searchStatus) {
      searchStatus.textContent = query
        ? data.degraded
          ? t(
            "Local grounded Maker Tag recall is active while AI ARX is unavailable.",
            "AI ARX를 사용할 수 없는 동안 로컬 Maker Tag 근거 검색이 적용됩니다."
          )
          : t("ARX returned grounded Maker Tags.", "ARX가 근거 있는 Maker Tag를 반환했습니다.")
        : t("AI ARX is ready.", "AI ARX가 준비되었습니다.");
    }
  } catch (error) {
    if (sequence !== searchSequence) return;
    renderMatches([], t("Among registered makers, ARX does not find a grounded match yet.", "아직 등록된 메이커 중에는 없습니다."), "");
    renderArxExtras();
    if (searchStatus) searchStatus.textContent = t("Artihubs could not complete this search.", "Artihubs가 이 검색을 완료하지 못했습니다.");
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
    searchInput.value = t(`Find Maker Tags for ${parts.join(" in ")}.`, `${parts.join(" / ")} Maker Tag를 찾아주세요.`);
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
  if (searchStatus) searchStatus.textContent = t("Maker data could not be loaded.", "메이커 데이터를 불러오지 못했습니다.");
});
