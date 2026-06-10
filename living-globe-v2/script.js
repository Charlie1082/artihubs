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
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let prefersReducedMotion = reducedMotionQuery.matches;
const isMobileViewport = window.matchMedia("(max-width: 700px)").matches;
const size = 760;
const sphereRadius = 342;
const minZoom = 0.86;
const maxZoom = 3;
const minCountryZoom = 1;
const maxCountryZoom = 3;
const idleRotationDelay = 1800;
const baseAutoRotationSpeed = 0.00118;
const graticuleGeometry = geoGraticule10();
const autoRotationSpeed = isLandingEmbed || isMobileViewport ? baseAutoRotationSpeed * 0.82 : baseAutoRotationSpeed;
const autoRotationFrameMs = isLandingEmbed || isMobileViewport ? 33 : 16;
const globeProjection = geoOrthographic()
  .translate([size / 2, size / 2])
  .scale(sphereRadius)
  .clipAngle(90)
  .precision(isLandingEmbed ? 1 : isMobileViewport ? 0.9 : 0.75)
  .rotate([-124, -24, 0]);
let projection = globeProjection;
const path = geoPath(projection);
const regionsByCountry = new Map();
const regionsById = new Map(regions.map((region) => [region.id, region]));
const adminCodeByCountryId = {
  "076": "BRA",
  "276": "DEU",
  "356": "IND",
  "392": "JPN",
  "410": "KOR",
  "840": "USA"
};
const countryFitBoundsByCountryId = {
  "076": [-74.0379, -33.734, -34.6566, 5.1747],
  "276": [5.8671, 47.2703, 15.0418, 55.0462],
  "356": [68.0938, 6.7598, 97.4115, 37.0775],
  "392": [122.9337, 24.0457, 153.9866, 45.5229],
  "410": [124.6136, 33.1976, 130.9207, 38.6243],
  "840": [-124.7627, 24.5231, -66.9506, 49.3844]
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
let lastAutoUpdateAt = performance.now();
let suppressMapClickUntil = 0;
let mapStyleDirty = true;
let markerLayerSize = size;
let mapUpdateFrame = 0;
let adminPreloadActive = false;
const adminFeaturePromises = new Map();
const adminPreloadQueue = [];

function regionLabel(region) {
  return `${region.country} / ${region.regionName}`;
}

function normalizeCountryId(id) {
  return String(id).padStart(3, "0");
}

function pauseAutoRotation(duration = idleRotationDelay) {
  pausedUntil = prefersReducedMotion ? Number.POSITIVE_INFINITY : performance.now() + duration;
}

function syncReducedMotionPreference(event = reducedMotionQuery) {
  prefersReducedMotion = event.matches;
  stage.classList.toggle("prefers-reduced-motion", prefersReducedMotion);
  if (prefersReducedMotion) pausedUntil = Number.POSITIVE_INFINITY;
  else if (!Number.isFinite(pausedUntil)) pausedUntil = performance.now() + 900;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isActivationKey(event) {
  return event.key === "Enter" || event.key === " ";
}

function markMapStyleDirty() {
  mapStyleDirty = true;
}

function requestIdleWork(callback, timeout = 1400) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout });
    return;
  }
  window.setTimeout(callback, 180);
}

function requestMapUpdate() {
  if (mapUpdateFrame) return;
  mapUpdateFrame = requestAnimationFrame(() => {
    mapUpdateFrame = 0;
    updateMap();
  });
}

function updateMarkerLayerSize() {
  markerLayerSize = markerLayer.getBoundingClientRect().width || size;
}

function queueAdminPreload(countryId, { front = false, userIntent = false } = {}) {
  if (isLandingEmbed || !countryId || !adminCodeByCountryId[countryId]) return;
  if (isMobileViewport && !userIntent) return;
  if (adminFeatureCache.has(countryId) || adminFeaturePromises.has(countryId)) return;
  if (adminPreloadQueue.includes(countryId)) return;

  if (front) adminPreloadQueue.unshift(countryId);
  else adminPreloadQueue.push(countryId);

  if (!adminPreloadActive) drainAdminPreloadQueue();
}

function drainAdminPreloadQueue() {
  if (!adminPreloadQueue.length) {
    adminPreloadActive = false;
    return;
  }

  adminPreloadActive = true;
  requestIdleWork(() => {
    const countryId = adminPreloadQueue.shift();
    if (!countryId) {
      drainAdminPreloadQueue();
      return;
    }

    loadAdminRegions(countryId)
      .catch((error) => console.warn(error))
      .finally(() => {
        window.setTimeout(drainAdminPreloadQueue, isMobileViewport ? 720 : 360);
      });
  });
}

function setZoom(nextZoom, pauseDuration = 2400) {
  if (viewMode !== "globe") return;
  zoomLevel = clamp(nextZoom, minZoom, maxZoom);
  globeProjection.scale(sphereRadius * zoomLevel);
  stage.dataset.zoom = zoomLevel.toFixed(2);
  zoomStatus.textContent = `${Math.round(zoomLevel * 100)}%`;
  pauseAutoRotation(pauseDuration);
  requestMapUpdate();
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
  requestMapUpdate();
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

function signedRingArea(ring) {
  let area = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    area += ring[previous][0] * ring[index][1] - ring[index][0] * ring[previous][1];
  }
  return area / 2;
}

function orientRingForD3(ring, exterior = false) {
  const clockwise = signedRingArea(ring) < 0;
  const shouldBeClockwise = exterior;
  return clockwise === shouldBeClockwise ? ring : [...ring].reverse();
}

function orientPolygonForD3(polygon) {
  return polygon.map((ring, index) => orientRingForD3(ring, index === 0));
}

function rewindGeometryForD3(geometry) {
  if (!geometry) return geometry;
  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: orientPolygonForD3(geometry.coordinates)
    };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map(orientPolygonForD3)
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

function visitCoordinates(coordinates, callback) {
  if (typeof coordinates?.[0] === "number") {
    callback(coordinates);
    return;
  }
  coordinates?.forEach((item) => visitCoordinates(item, callback));
}

function featureBounds(geoFeature) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const features = geoFeature?.type === "FeatureCollection" ? geoFeature.features : [geoFeature];
  features.forEach((item) => {
    visitCoordinates(item?.geometry?.coordinates, ([longitude, latitude]) => {
      bounds[0] = Math.min(bounds[0], longitude);
      bounds[1] = Math.min(bounds[1], latitude);
      bounds[2] = Math.max(bounds[2], longitude);
      bounds[3] = Math.max(bounds[3], latitude);
    });
  });
  return bounds.every(Number.isFinite) ? bounds : [-10, -10, 10, 10];
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

function getRenderableAdminFeatures(features) {
  return features.filter((adminFeature) => isMainlandAdminFeature(adminFeature.__countryId, adminFeature));
}

function getProjectionFeature(countryId, countryFeature) {
  return countryFeature;
}

function createProjectionFromBounds(bounds) {
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = bounds;
  const [[left, top], [right, bottom]] = [[80, 74], [680, 686]];
  const radians = Math.PI / 180;
  const safeMinLatitude = clamp(minLatitude, -84, 84);
  const safeMaxLatitude = clamp(maxLatitude, -84, 84);
  const x0 = minLongitude * radians;
  const x1 = maxLongitude * radians;
  const y0 = -Math.log(Math.tan(Math.PI / 4 + (safeMaxLatitude * radians) / 2));
  const y1 = -Math.log(Math.tan(Math.PI / 4 + (safeMinLatitude * radians) / 2));
  const scale = Math.min((right - left) / Math.max(x1 - x0, 0.001), (bottom - top) / Math.max(y1 - y0, 0.001));
  const translate = [
    (left + right) / 2 - scale * ((x0 + x1) / 2),
    (top + bottom) / 2 - scale * ((y0 + y1) / 2)
  ];

  return geoMercator()
    .precision(0.4)
    .scale(scale)
    .translate(translate);
}

function createCountryProjection(countryId, countryFeature) {
  const bounds = countryFitBoundsByCountryId[countryId] || featureBounds(countryFeature);
  return createProjectionFromBounds(bounds);
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

    if (viewMode === "country" && !isSelectedCountry) {
      if (countryPath.__lastPathMode !== "country-hidden") {
        countryPath.setAttribute("d", "");
        countryPath.__lastPathMode = "country-hidden";
      }
      return;
    }

    if (isSelectedCountry && adminFeatureCache.has(countryId)) {
      if (countryPath.__lastPathMode !== "country-admin-overlay") {
        countryPath.setAttribute("d", "");
        countryPath.__lastPathMode = "country-admin-overlay";
      }
      return;
    }

    const displayFeature = isSelectedCountry ? getProjectionFeature(countryId, countryPath.__feature) : countryPath.__feature;
    countryPath.setAttribute("d", path(displayFeature) || "");
    countryPath.__lastPathMode = isSelectedCountry ? "country-focus" : "globe";
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
    const region = button.__region || regionsById.get(button.dataset.regionId);
    const projected = projection(region.coordinates);
    const visible =
      projected &&
      isVisible(region.coordinates) &&
      (viewMode === "country" ? region.countryId === selectedCountryId : true);

    button.classList.toggle("is-hidden", !visible);
    if (!visible) return;

    const scale = markerLayerSize / size;
    button.style.setProperty("--marker-x", `${projected[0] * scale}px`);
    button.style.setProperty("--marker-y", `${projected[1] * scale}px`);
  });
}

function updateMap() {
  graticule.setAttribute("d", viewMode === "globe" ? path(graticuleGeometry) : "");
  updateCountryPaths();
  updateAdminPaths();
  if (mapStyleDirty) updateFootprints();
  updateMarkers();
  mapStyleDirty = false;
}

function runMapTransition(callback) {
  if (stage.classList.contains("is-transitioning")) return;
  stage.classList.add("is-transitioning");
  stage.classList.add("is-performance-pass");
  window.setTimeout(() => {
    callback();
    updateMap();
    window.setTimeout(() => {
      stage.classList.remove("is-transitioning");
      stage.classList.remove("is-performance-pass");
    }, 180);
  }, 160);
}

function enterCountryMap(countryId, region = getCountryRegions(countryId)[0]) {
  const countryFeature = getCountryFeature(countryId);
  if (!countryFeature) return;

  runMapTransition(() => {
    selectedCountryId = countryId;
    viewMode = "country";
    stage.classList.add("is-country-map");
    paintAdminRegions(adminFeatureCache.get(countryId) || []);
    setCountryProjection(createCountryProjection(countryId, countryFeature));
    markMapStyleDirty();
    zoomStatus.textContent = getCountryRegions(countryId)[0]?.country || "Map";
    pauseAutoRotation(1000000);
    renderCountrySummary(countryId);
    if (region) renderRegion(region);
  });

  loadAdminRegions(countryId)
    .then((countryAdminFeatures) => {
      if (viewMode !== "country" || selectedCountryId !== countryId) return;
      if (countryZoomLevel === 1 && countryPan[0] === 0 && countryPan[1] === 0) {
        setCountryProjection(createCountryProjection(countryId, countryFeature));
      }
      paintAdminRegions(countryAdminFeatures);
      markMapStyleDirty();
      requestMapUpdate();
    })
    .catch((adminError) => console.warn(adminError));
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
  const dot = document.createElement("span");
  button.className = "marker";
  dot.className = "marker-dot";
  button.type = "button";
  button.dataset.regionId = region.id;
  button.__region = region;
  button.style.setProperty("--marker-color", region.color);
  button.setAttribute("aria-label", `${regionLabel(region)}: ${region.makers.length} registered makers`);
  button.append(dot);
  if (isLandingEmbed) {
    button.tabIndex = -1;
    markerLayer.append(button);
    return button;
  }
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    pauseAutoRotation(5200);
    queueAdminPreload(region.countryId, { front: true, userIntent: true });
  });
  button.addEventListener("mouseenter", () => {
    pauseAutoRotation(5200);
    queueAdminPreload(region.countryId, { front: true, userIntent: true });
    renderRegion(region);
  });
  button.addEventListener("focus", () => {
    pauseAutoRotation(5200);
    queueAdminPreload(region.countryId, { front: true, userIntent: true });
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
  if (adminFeaturePromises.has(countryId)) return adminFeaturePromises.get(countryId);

  const adminCode = adminCodeByCountryId[countryId];
  if (!adminCode) return [];

  const promise = (async () => {
    let response = await fetch(`./assets/admin-regions-lite/${adminCode}-ADM1.geojson`, { cache: "force-cache" });

    if (!response.ok) {
      response = await fetch(`./assets/admin-regions/${adminCode}-ADM1.geojson`, { cache: "force-cache" });
    }

    if (!response.ok) {
      const metadataResponse = await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${adminCode}/ADM1/`);
      if (!metadataResponse.ok) throw new Error("Admin region metadata could not be loaded.");

      const metadata = await metadataResponse.json();
      const geojsonUrl = metadata.simplifiedGeometryGeoJSON || metadata.gjDownloadURL;
      if (!geojsonUrl) throw new Error("Admin region geometry is unavailable.");

      response = await fetch(geojsonUrl, { cache: "force-cache" });
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
  })();

  adminFeaturePromises.set(countryId, promise);
  try {
    return await promise;
  } finally {
    adminFeaturePromises.delete(countryId);
  }
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
      if (regionsByCountry.has(countryId)) {
        countryPath.setAttribute("role", "button");
        countryPath.setAttribute("tabindex", "0");
      }
      countryPath.addEventListener("click", () => {
        if (regionsByCountry.has(countryId)) enterCountryMap(countryId);
      });
      countryPath.addEventListener("mouseenter", () => {
        queueAdminPreload(countryId, { front: true, userIntent: true });
        if (viewMode === "globe" && regionsByCountry.has(countryId)) renderCountrySummary(countryId);
      });
      countryPath.addEventListener("focus", () => {
        queueAdminPreload(countryId, { front: true, userIntent: true });
        if (viewMode === "globe" && regionsByCountry.has(countryId)) renderCountrySummary(countryId);
      });
      countryPath.addEventListener("keydown", (event) => {
        if (!isActivationKey(event) || !regionsByCountry.has(countryId)) return;
        event.preventDefault();
        enterCountryMap(countryId);
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

  getRenderableAdminFeatures(features).forEach((adminFeature) => {
    const adminPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    adminPath.__feature = adminFeature;
    adminPath.dataset.countryId = adminFeature.__countryId;
    adminPath.classList.add("admin-region");
    adminPath.setAttribute("aria-label", adminFeatureName(adminFeature) || "Region");
    if (!isLandingEmbed) {
      if (adminFeature.__regionIds?.length) {
        adminPath.setAttribute("role", "button");
        adminPath.setAttribute("tabindex", "0");
      }
      adminPath.addEventListener("click", () => {
        const region = regions.find((item) => adminFeature.__regionIds?.includes(item.id));
        if (region) renderRegion(region);
      });
      adminPath.addEventListener("keydown", (event) => {
        if (!isActivationKey(event)) return;
        const region = regions.find((item) => adminFeature.__regionIds?.includes(item.id));
        if (!region) return;
        event.preventDefault();
        renderRegion(region);
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
  stage.classList.add("is-interacting");
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

  requestMapUpdate();
}

function handlePointerUp(event) {
  if (!dragState) return;
  stage.releasePointerCapture(event.pointerId);
  if (dragState.type === "country" && dragState.moved) {
    suppressMapClickUntil = performance.now() + 320;
  }
  dragState = null;
  stage.classList.remove("is-interacting");
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
  if (document.hidden || prefersReducedMotion) {
    lastAutoFrame = now;
    lastAutoUpdateAt = now;
    requestAnimationFrame(autoRotate);
    return;
  }

  const shouldRotate = viewMode === "globe" && !dragState && now > pausedUntil && countryFeatures.length;
  if (!shouldRotate) {
    lastAutoFrame = now;
    requestAnimationFrame(autoRotate);
    return;
  }

  if (now - lastAutoUpdateAt < autoRotationFrameMs) {
    requestAnimationFrame(autoRotate);
    return;
  }

  const delta = Math.min(now - lastAutoFrame, 50);
  lastAutoFrame = now;
  lastAutoUpdateAt = now;

  if (shouldRotate) {
    const rotation = globeProjection.rotate();
    globeProjection.rotate([rotation[0] + delta * autoRotationSpeed, rotation[1], 0]);
    requestMapUpdate();
  }

  requestAnimationFrame(autoRotate);
}

async function init() {
  syncReducedMotionPreference();
  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", syncReducedMotionPreference);
  } else if (typeof reducedMotionQuery.addListener === "function") {
    reducedMotionQuery.addListener(syncReducedMotionPreference);
  }

  updateMarkerLayerSize();
  window.addEventListener("resize", updateMarkerLayerSize);
  if ("ResizeObserver" in window) {
    new ResizeObserver(updateMarkerLayerSize).observe(markerLayer);
  }

  markerButtons = regions.map(createMarker);
  paintRegionFootprints();
  updateMarkers();

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
  if (!isLandingEmbed && !isMobileViewport) {
    requestIdleWork(() => {
      queueAdminPreload(selectedRegion.countryId, { front: true });
    }, 1800);
  }
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
