import {
  geoCircle,
  geoDistance,
  geoGraticule10,
  geoMercator,
  geoOrthographic,
  geoPath
} from "https://cdn.jsdelivr.net/npm/d3-geo@3/+esm";
import { feature } from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";

const regions = [
  {
    id: "seoul",
    country: "Korea",
    countryId: "410",
    regionName: "Seoul",
    coordinates: [126.978, 37.5665],
    radius: 1.15,
    color: "#4cc9ff",
    field: "assistive hardware",
    makers: [
      ["Quiet Forge Lab", "compact robotics parts"],
      ["Hanbit Interface", "assistive hardware prototypes"]
    ]
  },
  {
    id: "busan",
    country: "Korea",
    countryId: "410",
    regionName: "Busan",
    coordinates: [129.0756, 35.1796],
    radius: 1.1,
    color: "#4d8dff",
    field: "marine sensors",
    makers: [["Harbor Microfactory", "waterproof sensor housings"]]
  },
  {
    id: "california",
    country: "United States",
    countryId: "840",
    regionName: "California",
    coordinates: [-119.4179, 36.7783],
    radius: 4.2,
    color: "#a78bfa",
    field: "controller boards",
    makers: [
      ["Patchworks Motion", "small-batch controller boards"],
      ["Signal Loom", "AI workflow tools"]
    ]
  },
  {
    id: "texas",
    country: "United States",
    countryId: "840",
    regionName: "Texas",
    coordinates: [-99.9018, 31.9686],
    radius: 4.35,
    color: "#ff8a7a",
    field: "garage CNC",
    makers: [["Lone Star Fixtures", "desktop CNC production jigs"]]
  },
  {
    id: "karnataka",
    country: "India",
    countryId: "356",
    regionName: "Karnataka",
    coordinates: [75.7139, 15.3173],
    radius: 3.3,
    color: "#ffd166",
    field: "sensor fixtures",
    makers: [
      ["Banyan MicroWorks", "sensor fixtures"],
      ["Open Loom Studio", "industrial design mockups"]
    ]
  },
  {
    id: "osaka",
    country: "Japan",
    countryId: "392",
    regionName: "Osaka",
    coordinates: [135.5023, 34.6937],
    radius: 1.05,
    color: "#ff8ccf",
    field: "repair kits",
    makers: [["Machi Repair Works", "compact repairable product kits"]]
  },
  {
    id: "berlin",
    country: "Germany",
    countryId: "276",
    regionName: "Berlin",
    coordinates: [13.405, 52.52],
    radius: 0.92,
    color: "#ffb36b",
    field: "repairable products",
    makers: [["Northline Repair", "repairable product kits"]]
  },
  {
    id: "sao-paulo",
    country: "Brazil",
    countryId: "076",
    regionName: "Sao Paulo",
    coordinates: [-46.6333, -23.5505],
    radius: 2.7,
    color: "#b9a7ff",
    field: "agritech",
    makers: [["Campo Modular", "agritech field modules"]]
  }
];

const countryLayer = document.querySelector("#country-layer");
const adminLayer = document.querySelector("#admin-layer");
const regionLayer = document.querySelector("#region-layer");
const graticule = document.querySelector("#graticule");
const markerLayer = document.querySelector("#marker-layer");
const stage = document.querySelector("#globe-stage");
const title = document.querySelector("#region-title");
const note = document.querySelector("#region-note");
const cards = document.querySelector("#cards");
const makerMetric = document.querySelector("#metric-makers");
const regionMetric = document.querySelector("#metric-regions");
const fieldMetric = document.querySelector("#metric-fields");
const zoomInButton = document.querySelector("#zoom-in");
const zoomOutButton = document.querySelector("#zoom-out");
const returnGlobeButton = document.querySelector("#return-globe");
const zoomStatus = document.querySelector("#globe-hint");
const exploreRegionLink = document.querySelector("#explore-region-link");

const searchParams = new URLSearchParams(window.location.search);
const isLandingEmbed = searchParams.get("embed") === "landing";
const size = 760;
const sphereRadius = 342;
const minZoom = 0.86;
const maxZoom = 3;
const minCountryZoom = 1;
const maxCountryZoom = 3;
const idleRotationDelay = 1800;
const autoRotationSpeed = 0.00118;
const globeProjection = geoOrthographic()
  .translate([size / 2, size / 2])
  .scale(sphereRadius)
  .clipAngle(90)
  .precision(isLandingEmbed ? 0.85 : 0.65)
  .rotate([-124, -24, 0]);
let projection = globeProjection;
const path = geoPath(projection);
const regionsByCountry = new Map();
const adminCodeByCountryId = {
  "076": "BRA",
  "276": "DEU",
  "356": "IND",
  "392": "JPN",
  "410": "KOR",
  "840": "USA"
};

regions.forEach((region) => {
  if (!regionsByCountry.has(region.countryId)) regionsByCountry.set(region.countryId, []);
  regionsByCountry.get(region.countryId).push(region);
});

let selectedRegion = regions[0];
let selectedCountryId = null;
let countryFeatures = [];
let countryPaths = [];
let adminPaths = [];
const adminFeatureCache = new Map();
let footprintPaths = [];
let markerButtons = [];
let dragState = null;
let zoomLevel = 1;
let countryZoomLevel = 1;
let countryBaseScale = 1;
let countryBaseTranslate = [size / 2, size / 2];
let countryPan = [0, 0];
let viewMode = "globe";
let pausedUntil = performance.now() + 900;
let lastAutoFrame = performance.now();
let suppressMapClickUntil = 0;
let mapStyleDirty = true;

function regionLabel(region) {
  return `${region.country} / ${region.regionName}`;
}

function normalizeCountryId(id) {
  return String(id).padStart(3, "0");
}

function pauseAutoRotation(duration = idleRotationDelay) {
  pausedUntil = performance.now() + duration;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function markMapStyleDirty() {
  mapStyleDirty = true;
}

function setZoom(nextZoom, pauseDuration = 2400) {
  if (viewMode !== "globe") return;
  zoomLevel = clamp(nextZoom, minZoom, maxZoom);
  globeProjection.scale(sphereRadius * zoomLevel);
  stage.dataset.zoom = zoomLevel.toFixed(2);
  zoomStatus.textContent = `${Math.round(zoomLevel * 100)}%`;
  pauseAutoRotation(pauseDuration);
  updateMap();
}

function clientPointToSvg(event) {
  const rect = stage.getBoundingClientRect();
  return [
    ((event.clientX - rect.left) / rect.width) * size,
    ((event.clientY - rect.top) / rect.height) * size
  ];
}

function applyCountryView() {
  if (viewMode !== "country") return;
  projection.scale(countryBaseScale * countryZoomLevel);
  projection.translate([
    countryBaseTranslate[0] + countryPan[0],
    countryBaseTranslate[1] + countryPan[1]
  ]);
  stage.dataset.countryZoom = countryZoomLevel.toFixed(2);
  stage.classList.toggle("is-country-zoomed", countryZoomLevel > 1.12);
  zoomStatus.textContent = `${Math.round(countryZoomLevel * 100)}%`;
}

function setCountryProjection(nextProjection) {
  countryZoomLevel = 1;
  countryPan = [0, 0];
  countryBaseScale = nextProjection.scale();
  countryBaseTranslate = nextProjection.translate();
  setProjection(nextProjection);
  applyCountryView();
}

function setCountryZoom(nextZoom, focalPoint = [size / 2, size / 2]) {
  if (viewMode !== "country") return;
  const previousZoom = countryZoomLevel;
  countryZoomLevel = clamp(nextZoom, minCountryZoom, maxCountryZoom);
  const zoomRatio = countryZoomLevel / previousZoom;
  const currentTranslate = projection.translate();
  const nextTranslate = [
    focalPoint[0] - (focalPoint[0] - currentTranslate[0]) * zoomRatio,
    focalPoint[1] - (focalPoint[1] - currentTranslate[1]) * zoomRatio
  ];
  countryPan = [
    nextTranslate[0] - countryBaseTranslate[0],
    nextTranslate[1] - countryBaseTranslate[1]
  ];
  applyCountryView();
  updateMap();
}

function getCountryRegions(countryId) {
  return regionsByCountry.get(countryId) || [];
}

function getCountryColor(countryId) {
  return getCountryRegions(countryId)[0]?.color || "#4c9dff";
}

function getCountryFeature(countryId) {
  return countryFeatures.find((country) => normalizeCountryId(country.id) === countryId);
}

function getRegionAdminName(region) {
  return {
    berlin: "Berlin",
    busan: "Busan",
    california: "California",
    karnataka: "Karnataka",
    osaka: "Osaka",
    "sao-paulo": "São Paulo",
    seoul: "Seoul",
    texas: "Texas"
  }[region.id];
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function adminFeatureName(adminFeature) {
  return (
    adminFeature.properties?.shapeName ||
    adminFeature.properties?.shapeISO ||
    adminFeature.properties?.name_en ||
    adminFeature.properties?.name ||
    adminFeature.properties?.NAME_1 ||
    ""
  );
}

function getAdminRegionColor(adminFeature) {
  const litRegion = regions.find((region) => adminFeature.__regionIds?.includes(region.id));
  return litRegion?.color || getCountryColor(adminFeature.__countryId);
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!polygon.length || !pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function pointInFeature(point, feature) {
  if (!feature?.geometry) return false;
  if (feature.geometry.type === "Polygon") return pointInPolygon(point, feature.geometry.coordinates);
  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  }
  return false;
}

function featureMatchesRegion(adminFeature, region) {
  const expectedName = normalizeName(getRegionAdminName(region));
  const actualName = normalizeName(adminFeatureName(adminFeature));
  if (expectedName && (actualName === expectedName || actualName.includes(expectedName))) return true;
  return pointInFeature(region.coordinates, adminFeature);
}

function rewindRing(ring) {
  return [...ring].reverse();
}

function rewindGeometryForD3(geometry) {
  if (!geometry) return geometry;
  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map(rewindRing)
    };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) => polygon.map(rewindRing))
    };
  }
  return geometry;
}

function featureCollection(features) {
  return {
    type: "FeatureCollection",
    features
  };
}

function isMainlandAdminFeature(countryId, adminFeature) {
  if (countryId !== "840") return true;
  const name = normalizeName(adminFeatureName(adminFeature));
  const outlyingNames = [
    "alaska",
    "hawaii",
    "puerto rico",
    "guam",
    "american samoa",
    "northern mariana islands",
    "united states virgin islands",
    "virgin islands"
  ];
  return !outlyingNames.some((outlyingName) => name === outlyingName || name.includes(outlyingName));
}

function getProjectionFeature(countryId, countryFeature) {
  const adminFeatures = adminFeatureCache.get(countryId) || [];
  const focusAdminFeatures = adminFeatures.filter((adminFeature) => isMainlandAdminFeature(countryId, adminFeature));
  if (focusAdminFeatures.length) return featureCollection(focusAdminFeatures);
  return countryFeature;
}

function createCountryProjection(countryId, countryFeature) {
  return geoMercator()
    .precision(0.4)
    .fitExtent([[80, 74], [680, 686]], getProjectionFeature(countryId, countryFeature));
}

function setProjection(nextProjection) {
  projection = nextProjection;
  path.projection(projection);
}

function renderRegion(region) {
  selectedRegion = region;
  title.textContent = regionLabel(region);
  note.textContent = `${region.field} signal. Country and region only; no address exposed.`;
  cards.innerHTML = region.makers
    .map(([name, capability]) => `<article class="card"><strong>${name}</strong><span>${capability}</span></article>`)
    .join("");

  markerButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.regionId === region.id);
  });

  footprintPaths.forEach((footprintPath) => {
    footprintPath.classList.toggle("is-selected", footprintPath.dataset.regionId === region.id);
  });

  if (exploreRegionLink) {
    const params = new URLSearchParams({
      country: region.country,
      region: region.regionName,
      field: region.field
    });
    exploreRegionLink.href = `../explore/?${params.toString()}`;
    exploreRegionLink.textContent = `Explore ${region.regionName}`;
  }
}

function renderCountrySummary(countryId) {
  const countryRegions = getCountryRegions(countryId);
  if (!countryRegions.length) return;
  renderRegion(countryRegions[0]);
  note.textContent = `${countryRegions.length} lit region${countryRegions.length > 1 ? "s" : ""}. Select a light for maker details.`;
}

function animateNumber(target, total) {
  let value = 0;
  const timer = setInterval(() => {
    value += 1;
    target.textContent = value;
    if (value >= total) clearInterval(timer);
  }, 72);
}

function updateMetrics() {
  const makerTotal = regions.flatMap((region) => region.makers).length;
  const fieldTotal = new Set(regions.map((region) => region.field)).size;
  animateNumber(makerMetric, makerTotal);
  animateNumber(regionMetric, regions.length);
  animateNumber(fieldMetric, fieldTotal);
}

function isVisible([longitude, latitude]) {
  if (viewMode === "country") return true;
  const rotation = globeProjection.rotate();
  const center = [-rotation[0], -rotation[1]];
  return geoDistance([longitude, latitude], center) <= Math.PI / 2;
}

function createFootprint(region) {
  return geoCircle()
    .center(region.coordinates)
    .radius(region.radius)
    .precision(28)();
}

function updateCountryPaths() {
  countryPaths.forEach((countryPath) => {
    const countryId = countryPath.dataset.countryId;
    const isSelectedCountry = viewMode === "country" && countryId === selectedCountryId;

    if (mapStyleDirty) {
      const isLit = regionsByCountry.has(countryId);
      countryPath.classList.toggle("is-lit", viewMode === "globe" && isLit);
      countryPath.classList.toggle("is-focus-map", isSelectedCountry);
      countryPath.classList.toggle("is-hidden", viewMode === "country" && !isSelectedCountry);
      countryPath.style.setProperty("--country-color", getCountryColor(countryId));
    }

    const displayFeature = isSelectedCountry ? getProjectionFeature(countryId, countryPath.__feature) : countryPath.__feature;
    countryPath.setAttribute("d", path(displayFeature) || "");
  });
}

function updateAdminPaths() {
  adminPaths.forEach((adminPath) => {
    const isVisible = viewMode === "country" && adminPath.dataset.countryId === selectedCountryId;

    if (mapStyleDirty) {
      const isLit = isVisible && adminPath.__feature.__regionIds?.length;
      adminPath.classList.toggle("is-visible", isVisible);
      adminPath.classList.toggle("is-lit", !!isLit);
      adminPath.style.setProperty("--admin-color", getAdminRegionColor(adminPath.__feature));
    }

    adminPath.setAttribute("d", isVisible ? path(adminPath.__feature) || "" : "");
  });
}

function updateFootprints() {
  footprintPaths.forEach((footprintPath) => {
    footprintPath.classList.add("is-hidden");
    footprintPath.setAttribute("d", "");
  });
}

function updateMarkers() {
  markerButtons.forEach((button) => {
    const region = regions.find((item) => item.id === button.dataset.regionId);
    const projected = projection(region.coordinates);
    const visible =
      projected &&
      isVisible(region.coordinates) &&
      (viewMode === "country" ? region.countryId === selectedCountryId : true);

    button.classList.toggle("is-hidden", !visible);
    if (!visible) return;

    button.style.left = `${(projected[0] / size) * 100}%`;
    button.style.top = `${(projected[1] / size) * 100}%`;
  });
}

function updateMap() {
  graticule.setAttribute("d", viewMode === "globe" ? path(geoGraticule10()) : "");
  updateCountryPaths();
  updateAdminPaths();
  if (mapStyleDirty) updateFootprints();
  updateMarkers();
  mapStyleDirty = false;
}

function runMapTransition(callback) {
  if (stage.classList.contains("is-transitioning")) return;
  stage.classList.add("is-transitioning");
  window.setTimeout(() => {
    callback();
    updateMap();
    window.setTimeout(() => stage.classList.remove("is-transitioning"), 180);
  }, 160);
}

async function enterCountryMap(countryId, region = getCountryRegions(countryId)[0]) {
  const countryFeature = getCountryFeature(countryId);
  if (!countryFeature) return;

  let countryAdminFeatures = [];
  try {
    countryAdminFeatures = await loadAdminRegions(countryId);
  } catch (adminError) {
    console.warn(adminError);
  }

  runMapTransition(() => {
    selectedCountryId = countryId;
    viewMode = "country";
    stage.classList.add("is-country-map");
    paintAdminRegions(countryAdminFeatures);
    setCountryProjection(createCountryProjection(countryId, countryFeature));
    markMapStyleDirty();
    zoomStatus.textContent = getCountryRegions(countryId)[0]?.country || "Map";
    pauseAutoRotation(1000000);
    renderCountrySummary(countryId);
    if (region) renderRegion(region);
  });
}

function returnToGlobe() {
  runMapTransition(() => {
    selectedCountryId = null;
    viewMode = "globe";
    stage.classList.remove("is-country-map");
    stage.classList.remove("is-country-zoomed");
    stage.dataset.countryZoom = "1.00";
    paintAdminRegions([]);
    setProjection(globeProjection);
    markMapStyleDirty();
    zoomStatus.textContent = `${Math.round(zoomLevel * 100)}%`;
    pauseAutoRotation(700);
    renderRegion(selectedRegion);
  });
}

function createMarker(region) {
  const button = document.createElement("button");
  button.className = "marker";
  button.type = "button";
  button.dataset.regionId = region.id;
  button.style.setProperty("--marker-color", region.color);
  button.setAttribute("aria-label", `${regionLabel(region)}: ${region.makers.length} registered makers`);
  if (isLandingEmbed) {
    button.tabIndex = -1;
    markerLayer.append(button);
    return button;
  }
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    pauseAutoRotation(5200);
  });
  button.addEventListener("mouseenter", () => {
    pauseAutoRotation(5200);
    renderRegion(region);
  });
  button.addEventListener("click", () => {
    pauseAutoRotation(6200);
    if (viewMode === "globe") {
      enterCountryMap(region.countryId, region);
    } else {
      renderRegion(region);
    }
  });
  markerLayer.append(button);
  return button;
}

async function loadCountries() {
  const response = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json");
  if (!response.ok) throw new Error("World map data could not be loaded.");
  const topology = await response.json();
  return feature(topology, topology.objects.countries).features;
}

async function loadAdminRegions(countryId) {
  if (adminFeatureCache.has(countryId)) return adminFeatureCache.get(countryId);

  const adminCode = adminCodeByCountryId[countryId];
  if (!adminCode) return [];

  let response = await fetch(`./assets/admin-regions/${adminCode}-ADM1.geojson`);

  if (!response.ok) {
    const metadataResponse = await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${adminCode}/ADM1/`);
    if (!metadataResponse.ok) throw new Error("Admin region metadata could not be loaded.");

    const metadata = await metadataResponse.json();
    const geojsonUrl = metadata.simplifiedGeometryGeoJSON || metadata.gjDownloadURL;
    if (!geojsonUrl) throw new Error("Admin region geometry is unavailable.");

    response = await fetch(geojsonUrl);
  }

  if (!response.ok) throw new Error("Admin region data could not be loaded.");

  const collection = await response.json();
  const adminFeatures = collection.features
    .map((rawAdminFeature) => {
      const adminFeature = {
        ...rawAdminFeature,
        geometry: rewindGeometryForD3(rawAdminFeature.geometry)
      };
      adminFeature.__countryId = countryId;
      adminFeature.__regionIds = regions
        .filter((region) => region.countryId === countryId && featureMatchesRegion(adminFeature, region))
        .map((region) => region.id);
      return adminFeature;
    })
    .filter(Boolean);

  adminFeatureCache.set(countryId, adminFeatures);
  return adminFeatures;
}

function paintCountries(features) {
  const fragment = document.createDocumentFragment();

  features.forEach((country) => {
    const countryId = normalizeCountryId(country.id);
    const countryPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    countryPath.__feature = country;
    countryPath.dataset.countryId = countryId;
    countryPath.classList.add("country");
    countryPath.setAttribute("aria-label", country.properties?.name || "Country");
    if (!isLandingEmbed) {
      countryPath.addEventListener("click", () => {
        if (regionsByCountry.has(countryId)) enterCountryMap(countryId);
      });
      countryPath.addEventListener("mouseenter", () => {
        if (viewMode === "globe" && regionsByCountry.has(countryId)) renderCountrySummary(countryId);
      });
    }
    fragment.append(countryPath);
    countryPaths.push(countryPath);
  });

  countryLayer.append(fragment);
  markMapStyleDirty();
}

function paintAdminRegions(features) {
  adminLayer.replaceChildren();
  adminPaths = [];

  const fragment = document.createDocumentFragment();

  features.forEach((adminFeature) => {
    const adminPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    adminPath.__feature = adminFeature;
    adminPath.dataset.countryId = adminFeature.__countryId;
    adminPath.classList.add("admin-region");
    adminPath.setAttribute("aria-label", adminFeatureName(adminFeature) || "Region");
    if (!isLandingEmbed) {
      adminPath.addEventListener("click", () => {
        const region = regions.find((item) => adminFeature.__regionIds?.includes(item.id));
        if (region) renderRegion(region);
      });
    }
    adminPaths.push(adminPath);
    fragment.append(adminPath);
  });

  adminLayer.append(fragment);
  markMapStyleDirty();
}

function paintRegionFootprints() {
  const fragment = document.createDocumentFragment();

  regions.forEach((region) => {
    const footprintPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    footprintPath.__feature = createFootprint(region);
    footprintPath.classList.add("region-footprint");
    footprintPath.dataset.regionId = region.id;
    footprintPath.style.setProperty("--region-color", region.color);
    footprintPath.setAttribute("aria-label", `${regionLabel(region)} lit region`);
    if (!isLandingEmbed) {
      footprintPath.addEventListener("mouseenter", () => {
        pauseAutoRotation(5200);
        renderRegion(region);
      });
      footprintPath.addEventListener("click", () => {
        pauseAutoRotation(6200);
        renderRegion(region);
      });
    }
    footprintPaths.push(footprintPath);
    fragment.append(footprintPath);
  });

  regionLayer.append(fragment);
}

function handlePointerDown(event) {
  if (event.target.closest(".globe-controls")) return;
  pauseAutoRotation(6200);
  stage.setPointerCapture(event.pointerId);
  if (viewMode === "globe") {
    dragState = {
      type: "globe",
      x: event.clientX,
      y: event.clientY,
      rotate: globeProjection.rotate()
    };
    return;
  }

  if (viewMode === "country") {
    dragState = {
      type: "country",
      x: event.clientX,
      y: event.clientY,
      pan: [...countryPan],
      moved: false
    };
  }
}

function handlePointerMove(event) {
  if (!dragState) return;
  const dx = event.clientX - dragState.x;
  const dy = event.clientY - dragState.y;

  if (dragState.type === "globe" && viewMode === "globe") {
    const nextLongitude = dragState.rotate[0] + dx * 0.38;
    const nextLatitude = Math.max(-72, Math.min(72, dragState.rotate[1] - dy * 0.28));
    globeProjection.rotate([nextLongitude, nextLatitude, 0]);
  }

  if (dragState.type === "country" && viewMode === "country") {
    const rect = stage.getBoundingClientRect();
    countryPan = [
      dragState.pan[0] + (dx / rect.width) * size,
      dragState.pan[1] + (dy / rect.height) * size
    ];
    applyCountryView();
    dragState.moved = Math.abs(dx) + Math.abs(dy) > 5;
    if (dragState.moved) suppressMapClickUntil = performance.now() + 320;
  }

  updateMap();
}

function handlePointerUp(event) {
  if (!dragState) return;
  stage.releasePointerCapture(event.pointerId);
  if (dragState.type === "country" && dragState.moved) {
    suppressMapClickUntil = performance.now() + 320;
  }
  dragState = null;
  pauseAutoRotation(3600);
}

function handleWheel(event) {
  if (viewMode !== "globe" && viewMode !== "country") return;
  event.preventDefault();
  const zoomFactor = Math.exp(-event.deltaY * 0.0012);
  if (viewMode === "globe") {
    setZoom(zoomLevel * zoomFactor, 2600);
  } else {
    setCountryZoom(countryZoomLevel * zoomFactor, clientPointToSvg(event));
  }
}

function handleZoomButton(event, factor) {
  event.stopPropagation();
  if (viewMode === "globe") {
    setZoom(zoomLevel * factor, 2600);
  } else {
    setCountryZoom(countryZoomLevel * factor);
  }
}

function handleMapAreaClick(event) {
  if (viewMode !== "country") return;
  if (performance.now() < suppressMapClickUntil) return;
  if (event.target.closest(".marker, .country, .admin-region, .region-footprint, .globe-controls")) return;
  returnToGlobe();
}

function handleDocumentPointerDown(event) {
  if (viewMode === "country" && !stage.contains(event.target)) returnToGlobe();
}

function autoRotate(now) {
  if (document.hidden) {
    lastAutoFrame = now;
    requestAnimationFrame(autoRotate);
    return;
  }

  const delta = Math.min(now - lastAutoFrame, 34);
  lastAutoFrame = now;

  if (viewMode === "globe" && !dragState && now > pausedUntil && countryFeatures.length) {
    const rotation = globeProjection.rotate();
    globeProjection.rotate([rotation[0] + delta * autoRotationSpeed, rotation[1], 0]);
    updateMap();
  }

  requestAnimationFrame(autoRotate);
}

async function init() {
  markerButtons = regions.map(createMarker);
  paintRegionFootprints();

  try {
    countryFeatures = await loadCountries();
    paintCountries(countryFeatures);
    updateMap();
  } catch (error) {
    console.error(error);
    markerLayer.insertAdjacentHTML(
      "beforeend",
      '<p class="map-error">Map data is unavailable. Please reload this prototype.</p>'
    );
  }

  renderRegion(regions[0]);
  setZoom(1, 900);
  updateMetrics();
  requestAnimationFrame(autoRotate);
}

if (!isLandingEmbed) {
  stage.addEventListener("pointerdown", handlePointerDown);
  stage.addEventListener("pointermove", handlePointerMove);
  stage.addEventListener("pointerup", handlePointerUp);
  stage.addEventListener("pointercancel", handlePointerUp);
  stage.addEventListener("wheel", handleWheel, { passive: false });
  stage.addEventListener("click", handleMapAreaClick);
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  zoomInButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  zoomOutButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  returnGlobeButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  zoomInButton.addEventListener("click", (event) => handleZoomButton(event, 1.18));
  zoomOutButton.addEventListener("click", (event) => handleZoomButton(event, 1 / 1.18));
  returnGlobeButton.addEventListener("click", returnToGlobe);
}

init();
