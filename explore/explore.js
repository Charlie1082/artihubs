const makers = [
  {
    name: "Quiet Forge Lab",
    country: "Korea",
    region: "Seoul",
    field: "assistive hardware",
    capability: "compact robotics parts",
    tags: ["robotics", "small-batch", "sensor housings"],
    summary: "Builds compact parts and assistive hardware prototypes for small teams."
  },
  {
    name: "Hanbit Interface",
    country: "Korea",
    region: "Seoul",
    field: "assistive hardware",
    capability: "assistive hardware prototypes",
    tags: ["accessibility", "interfaces", "prototype"],
    summary: "Designs early assistive hardware interfaces with practical assembly constraints."
  },
  {
    name: "Harbor Microfactory",
    country: "Korea",
    region: "Busan",
    field: "marine sensors",
    capability: "waterproof sensor housings",
    tags: ["marine", "waterproof", "fixtures"],
    summary: "Makes small waterproof housings and test fixtures for marine sensor projects."
  },
  {
    name: "Patchworks Motion",
    country: "United States",
    region: "California",
    field: "controller boards",
    capability: "small-batch controller boards",
    tags: ["electronics", "motion", "firmware"],
    summary: "Builds controller board prototypes for motion systems and custom interfaces."
  },
  {
    name: "Signal Loom",
    country: "United States",
    region: "California",
    field: "controller boards",
    capability: "AI workflow tools",
    tags: ["software", "automation", "operators"],
    summary: "Creates lightweight AI workflow tools for solo operators and small studios."
  },
  {
    name: "Lone Star Fixtures",
    country: "United States",
    region: "Texas",
    field: "garage CNC",
    capability: "desktop CNC production jigs",
    tags: ["CNC", "jigs", "short-run"],
    summary: "Produces desktop CNC fixtures for repeatable short-run production."
  },
  {
    name: "Banyan MicroWorks",
    country: "India",
    region: "Karnataka",
    field: "sensor fixtures",
    capability: "sensor fixtures",
    tags: ["sensors", "industrial design", "fixtures"],
    summary: "Builds practical sensor fixtures and assembly aids for field prototypes."
  },
  {
    name: "Open Loom Studio",
    country: "India",
    region: "Karnataka",
    field: "sensor fixtures",
    capability: "industrial design mockups",
    tags: ["mockups", "prototype", "CAD"],
    summary: "Helps small teams move from rough physical idea to inspectable mockup."
  },
  {
    name: "Machi Repair Works",
    country: "Japan",
    region: "Osaka",
    field: "repair kits",
    capability: "compact repairable product kits",
    tags: ["repair", "kits", "consumer hardware"],
    summary: "Creates compact repair kits for small product teams and local operators."
  },
  {
    name: "Northline Repair",
    country: "Germany",
    region: "Berlin",
    field: "repairable products",
    capability: "repairable product kits",
    tags: ["repairability", "kits", "EU"],
    summary: "Focuses on repairable product concepts and kit-based service workflows."
  },
  {
    name: "Campo Modular",
    country: "Brazil",
    region: "Sao Paulo",
    field: "agritech",
    capability: "agritech field modules",
    tags: ["agritech", "field modules", "outdoor"],
    summary: "Builds field-ready modules for small agritech tests and local deployments."
  }
];

const searchFilter = document.querySelector("#search-filter");
const fieldFilter = document.querySelector("#field-filter");
const countryFilter = document.querySelector("#country-filter");
const regionFilter = document.querySelector("#region-filter");
const grid = document.querySelector("#maker-grid");
const emptyState = document.querySelector("#empty-state");
const introField = document.querySelector("#intro-field");

function unique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function fillSelect(select, values) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function markerFor(maker) {
  const initials = maker.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return initials;
}

function renderMakers() {
  const query = normalize(searchFilter.value);
  const field = fieldFilter.value;
  const country = countryFilter.value;
  const region = regionFilter.value;

  const visibleMakers = makers.filter((maker) => {
    const haystack = normalize([
      maker.name,
      maker.country,
      maker.region,
      maker.field,
      maker.capability,
      maker.summary,
      maker.tags.join(" ")
    ].join(" "));

    return (
      (!query || haystack.includes(query)) &&
      (!field || maker.field === field) &&
      (!country || maker.country === country) &&
      (!region || maker.region === region)
    );
  });

  grid.innerHTML = "";
  emptyState.classList.toggle("is-visible", visibleMakers.length === 0);

  visibleMakers.forEach((maker) => {
    const card = document.createElement("article");
    card.className = "maker-card";
    card.innerHTML = `
      <header>
        <div>
          <p class="eyebrow">${maker.country} / ${maker.region}</p>
          <h3>${maker.name}</h3>
        </div>
        <div class="avatar-mark">${markerFor(maker)}</div>
      </header>
      <p><strong>${maker.capability}</strong></p>
      <p>${maker.summary}</p>
      <div class="tag-row">
        ${maker.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
      </div>
      <button class="button secondary" type="button" data-intro="${maker.name} - ${maker.capability}">Request intro</button>
    `;
    grid.append(card);
  });
}

function syncRegionOptions() {
  const selectedCountry = countryFilter.value;
  const regions = makers
    .filter((maker) => !selectedCountry || maker.country === selectedCountry)
    .map((maker) => maker.region);

  const currentRegion = regionFilter.value;
  regionFilter.innerHTML = '<option value="">All regions</option>';
  fillSelect(regionFilter, unique(regions));

  if ([...regionFilter.options].some((option) => option.value === currentRegion)) {
    regionFilter.value = currentRegion;
  }
}

function applyUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const country = params.get("country");
  const region = params.get("region");
  const field = params.get("field");

  if (field && [...fieldFilter.options].some((option) => option.value === field)) fieldFilter.value = field;
  if (country && [...countryFilter.options].some((option) => option.value === country)) countryFilter.value = country;
  syncRegionOptions();
  if (region && [...regionFilter.options].some((option) => option.value === region)) regionFilter.value = region;
}

fillSelect(fieldFilter, unique(makers.map((maker) => maker.field)));
fillSelect(countryFilter, unique(makers.map((maker) => maker.country)));
fillSelect(regionFilter, unique(makers.map((maker) => maker.region)));
applyUrlParams();
renderMakers();

[searchFilter, fieldFilter, countryFilter, regionFilter].forEach((input) => {
  input.addEventListener("input", () => {
    if (input === countryFilter) syncRegionOptions();
    renderMakers();
  });
});

grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-intro]");
  if (!button || !introField) return;
  introField.value = button.dataset.intro;
  introField.scrollIntoView({ block: "center", behavior: "smooth" });
});
