import * as maplibregl from "https://unpkg.com/maplibre-gl@6.3.0/dist/maplibre-gl.mjs";
import { Protocol } from "https://unpkg.com/pmtiles@4.5.0/dist/esm/index.js";
import { makeDarkStyle } from "./dark-style.mjs";

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const status = document.querySelector(".status");
const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
const basemapStyleUrl = "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json";
let basemapStyle;
try {
  const response = await fetch(basemapStyleUrl);
  if (!response.ok) throw new Error(`Basemap style fetch failed: ${response.status}`);
  basemapStyle = await response.json();
} catch (error) {
  console.error(error);
  status.textContent = "Kartenhintergrund konnte nicht geladen werden.";
}

const colorCanvas = document.createElement("canvas");
colorCanvas.width = colorCanvas.height = 1;
const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
const colorCache = new Map();

function parseColor(value) {
  if (colorCache.has(value)) return colorCache.get(value);
  if (!colorContext || !CSS.supports("color", value)) {
    colorCache.set(value, null);
    return null;
  }
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = value;
  colorContext.fillRect(0, 0, 1, 1);
  const rgba = [...colorContext.getImageData(0, 0, 1, 1).data];
  colorCache.set(value, rgba);
  return rgba;
}

function styleForTheme(dark) {
  if (!basemapStyle) return basemapStyleUrl;
  return dark ? makeDarkStyle(basemapStyle, parseColor) : structuredClone(basemapStyle);
}

export const map = new maplibregl.Map({
  container: "map",
  style: styleForTheme(darkMode.matches),
  attributionControl: {
    customAttribution:
      "© EDA, © BAFU, © BABS, © SAC, © Naturfreunde Schweiz, © opentransportdata.swiss",
  },
  center: [8.73, 47.5],
  zoom: 13,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(
  new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }),
  "bottom-left",
);

const uncertain = document.querySelector("#uncertain");
const gradient = document.querySelector("#gradient");
const opacity = document.querySelector("#basemap-opacity");
const opacityValue = document.querySelector("#basemap-opacity-value");
const inspectSegment = document.querySelector("#inspect-segment");
const inspectStatus = document.querySelector("#inspect-status");
const modes = document.querySelectorAll('input[name="map-mode"]');
let activeMode = "roadbike";
let routeSourceLoaded = false;
let routeSourceFailed = false;
let basemapFailed = false;
const GRADE_STOPS = [3, 6, 10, 15];
const roadbikeWidth = ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 6];
const runWidths = { "run-paved": 3.5, "run-unpaved": 3.5, "run-unknown": 3 };

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function gradeColors() {
  return ["--grade-0", "--grade-3", "--grade-6", "--grade-10", "--grade-15"].map(cssColor);
}

function gradeStep(input, outputs) {
  return ["step", input, outputs[0], ...GRADE_STOPS.flatMap((stop, index) => [stop, outputs[index + 1]])];
}

function gradeExpression() {
  const [low, mild, moderate, steep, verySteep] = gradeColors();
  return ["case", ["==", ["get", "grade"], null], cssColor("--grade-missing"),
    gradeStep(["abs", ["get", "grade"]], [low, mild, moderate, steep, verySteep])];
}

function gradeWidth(base) {
  return ["*", base, gradeStep(["abs", ["coalesce", ["get", "grade"], 0]], [1, 1.15, 1.3, 1.45, 1.6])];
}

function roadbikeGradeWidth() {
  return ["interpolate", ["linear"], ["zoom"], 11, gradeWidth(2.5), 16, gradeWidth(6)];
}

function updateUnclear() {
  if (!map.getLayer("roadbike-check")) return;
  map.setPaintProperty("roadbike-check", "line-color", cssColor("--route-uncertain"));
  map.setPaintProperty("run-check", "line-color", cssColor("--route-uncertain"));
  map.setLayoutProperty("roadbike-check", "visibility", activeMode === "roadbike" && uncertain.checked ? "visible" : "none");
  map.setLayoutProperty("run-check", "visibility", activeMode === "running" && uncertain.checked ? "visible" : "none");
}

function updateGradient() {
  if (!map.getLayer("roadbike")) return;
  const graded = gradient.checked ? gradeExpression() : null;
  map.setPaintProperty("roadbike", "line-color", graded || cssColor("--route-bike"));
  map.setPaintProperty("run-paved", "line-color", graded || cssColor("--run-paved"));
  map.setPaintProperty("run-unpaved", "line-color", graded || cssColor("--run-unpaved"));
  map.setPaintProperty("run-unknown", "line-color", graded || cssColor("--run-unknown"));
  map.setPaintProperty("roadbike", "line-width", gradient.checked ? roadbikeGradeWidth() : roadbikeWidth);
  for (const [id, width] of Object.entries(runWidths)) map.setPaintProperty(id, "line-width", gradient.checked ? gradeWidth(width) : width);
  document.querySelector("#gradient-legend").hidden = !gradient.checked;
  document.querySelector("#plain-legend").hidden = gradient.checked || activeMode === "running";
}

function updateMode() {
  activeMode = document.querySelector('input[name="map-mode"]:checked').value;
  if (!map.getLayer("roadbike")) return;
  const running = activeMode === "running";
  for (const id of ["roadbike", "roadbike-direction"]) map.setLayoutProperty(id, "visibility", running ? "none" : "visible");
  for (const id of ["run-paved", "run-unpaved", "run-unknown"]) map.setLayoutProperty(id, "visibility", running ? "visible" : "none");
  document.querySelector("#roadbike-legend").hidden = running;
  document.querySelector("#running-legend").hidden = !running;
  updateUnclear();
  updateGradient();
  updateStatus();
}

function updateStatus() {
  if (routeSourceFailed && basemapFailed) status.textContent = "Kartenhintergrund und Routendaten konnten nicht geladen werden.";
  else if (routeSourceFailed) status.textContent = "Rennvelo- und Laufdaten konnten nicht geladen werden.";
  else if (basemapFailed && routeSourceLoaded) status.textContent = "Routendaten geladen; Kartenhintergrund konnte nicht geladen werden.";
  else if (basemapFailed) status.textContent = "Kartenhintergrund konnte nicht geladen werden.";
  else if (routeSourceLoaded) status.textContent = activeMode === "running" ? "Laufen · Zugang und Belag laut Kartendaten" : "Rennvelo · Belag und Zugang laut Kartendaten";
}

map.on("sourcedata", (event) => {
  if (event.sourceId === "roads" && event.isSourceLoaded) {
    routeSourceLoaded = true;
    updateStatus();
  }
});

map.on("error", (event) => {
  console.error(event.error);
  if (event.sourceId === "roads") routeSourceFailed = true;
  else basemapFailed = true;
  updateStatus();
});

function enableControls(enabled) {
  modes.forEach((radio) => { radio.disabled = !enabled; });
  uncertain.disabled = gradient.disabled = opacity.disabled = !enabled;
  inspectSegment.disabled = !enabled;
}

function installAppLayers() {
  basemapFailed = false;
  if (!map.getSource("roads")) map.addSource("roads", {
    type: "vector",
    url: `pmtiles://${new URL("./data/roads.pmtiles", import.meta.url).href}`,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  });
  if (!map.getSource("basemap-fade")) map.addSource("basemap-fade", { type: "geojson", data: {
    type: "Feature", properties: {},
    geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] },
  } });
  const addLayer = (layer) => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
  addLayer({ id: "basemap-fade", type: "fill", source: "basemap-fade",
    paint: { "fill-color": cssColor("--basemap-fade"), "fill-opacity": 1 - Number(opacity.value) / 100 },
  });
  map.setPaintProperty("basemap-fade", "fill-color", cssColor("--basemap-fade"));
  const source = { source: "roads", "source-layer": "roads", minzoom: 11 };
  const osm = ["==", ["get", "kind"], "osm"];
  addLayer({ id: "roadbike", type: "line", ...source,
    filter: ["all", osm, ["==", ["get", "status"], "yes"]],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": gradeExpression(), "line-width": roadbikeGradeWidth() },
  });
  addLayer({ id: "roadbike-check", type: "line", ...source,
    filter: ["all", osm, ["==", ["get", "status"], "review"]],
    layout: { visibility: "none" },
    paint: { "line-color": cssColor("--route-uncertain"), "line-width": 2.5, "line-dasharray": [2, 2] },
  });
  addLayer({ id: "roadbike-hit", type: "line", ...source,
    filter: osm,
    paint: { "line-color": "#000", "line-opacity": 0, "line-width": 16 },
  });
  // Local icon avoids dependence on a particular basemap's sprite/font contents.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 24;
  const context = canvas.getContext("2d");
  context.beginPath(); context.moveTo(8, 5); context.lineTo(16, 12); context.lineTo(8, 19);
  context.lineWidth = 6; context.strokeStyle = "white"; context.stroke();
  context.lineWidth = 3; context.strokeStyle = "#1b2921"; context.stroke();
  if (!map.hasImage("bike-direction")) map.addImage("bike-direction", context.getImageData(0, 0, 24, 24));
  addLayer({ id: "roadbike-direction", type: "symbol", ...source, minzoom: 14,
    filter: ["all", osm, ["==", ["get", "status"], "yes"], ["in", ["get", "direction"], ["literal", ["forward", "reverse"]]]],
    layout: { "symbol-placement": "line", "symbol-spacing": 120,
       "icon-image": "bike-direction", "icon-size": .65, "icon-rotation-alignment": "map",
       "icon-keep-upright": false, "icon-rotate": ["case", ["==", ["get", "direction"], "reverse"], 180, 0] },
  });
  const run = ["==", ["get", "foot_status"], "yes"];
  addLayer({ id: "run-paved", type: "line", ...source,
    filter: ["all", osm, run, ["==", ["get", "run_surface"], "paved"]],
    layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
    paint: { "line-color": cssColor("--run-paved"), "line-width": runWidths["run-paved"] },
  });
  addLayer({ id: "run-unpaved", type: "line", ...source,
    filter: ["all", osm, run, ["==", ["get", "run_surface"], "unpaved"]],
    layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
    paint: { "line-color": cssColor("--run-unpaved"), "line-width": runWidths["run-unpaved"], "line-dasharray": [3, 3] },
  });
  addLayer({ id: "run-unknown", type: "line", ...source,
    filter: ["all", osm, run, ["==", ["get", "run_surface"], "unknown"]],
    layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
    paint: { "line-color": cssColor("--run-unknown"), "line-width": runWidths["run-unknown"], "line-dasharray": [1, 1] },
  });
  addLayer({ id: "run-check", type: "line", ...source,
    filter: ["all", osm, ["==", ["get", "foot_status"], "review"]],
    layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
    paint: { "line-color": cssColor("--route-uncertain"), "line-width": 2.5, "line-dasharray": [2, 2] },
  });
  updateMode();
  enableControls(true);
  updateStatus();
}

map.on("style.load", installAppLayers);
modes.forEach((radio) => radio.addEventListener("change", updateMode));
uncertain.addEventListener("change", updateUnclear);
gradient.addEventListener("change", updateGradient);
opacity.addEventListener("input", () => {
  const value = Number(opacity.value);
  opacityValue.value = `${value}%`;
  if (map.getLayer("basemap-fade")) map.setPaintProperty("basemap-fade", "fill-opacity", 1 - value / 100);
});
darkMode.addEventListener("change", (event) => {
  if (!basemapStyle) return;
  enableControls(false);
  map.setStyle(styleForTheme(event.matches));
});

function parseJson(value, fallback) {
  try { return JSON.parse(value || ""); } catch { return fallback; }
}

function addParagraph(parent, text) {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  parent.append(paragraph);
}

function addFact(list, label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  list.append(term, description);
}

function addAccessFacts(list, tags) {
  const modes = {
    access: "Alle Verkehrsarten", vehicle: "Alle Fahrzeuge", bicycle: "Velos", foot: "Zu Fuss",
    motor_vehicle: "Motorfahrzeuge", motorcar: "Autos", motorcycle: "Motorräder", motorbike: "Motorfahrräder",
    agricultural: "Landwirtschaftliche Fahrzeuge", forestry: "Forstfahrzeuge",
  };
  const values = {
    yes: "erlaubt", no: "verboten", designated: "vorgesehen oder ausgeschildert",
    official: "offiziell bestimmt (veraltete Angabe)", permissive: "mit widerrufbarer Erlaubnis",
    private: "nur mit persönlicher Erlaubnis", destination: "nur für Zielverkehr",
    customers: "nur für Kundschaft", delivery: "nur für Lieferverkehr",
    forestry: "nur für Forstwirtschaft", agricultural: "nur für Landwirtschaft",
    permit: "nur mit Bewilligung", dismount: "nur schiebend",
    use_sidepath: "Parallelweg benutzen", discouraged: "erlaubt, aber nicht empfohlen",
    unknown: "unbekannt", variable: "zeitlich wechselnd", military: "nur für militärische Zwecke (umstrittene Verwendung)",
  };
  for (const [key, rawValue] of Object.entries(tags)) {
    const [mode, ...qualifiers] = key.split(":");
    if (!Object.hasOwn(modes, mode)) continue;
    const direction = qualifiers.includes("forward") ? "in eingezeichneter Richtung"
      : qualifiers.includes("backward") ? "gegen eingezeichnete Richtung" : "";
    const label = [modes[mode], direction, qualifiers.includes("conditional") ? "zeitabhängig" : ""]
      .filter(Boolean).join(" · ");
    const entries = String(rawValue).split("@")[0].trim().split(";").map((value) => value.trim());
    const descriptions = entries.map((value) => mode === "access" && ["designated", "official", "dismount", "use_sidepath"].includes(value)
      ? "nicht eindeutig für alle Verkehrsarten; bitte prüfen"
      : Object.hasOwn(values, value) ? values[value] : "nicht eindeutig (Details öffnen)");
    addFact(list, label, [...new Set(descriptions)].join(" oder "));
  }
}

function addRawTags(parent, values) {
  const tags = parseJson(values.tags, {});
  const entries = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b));
  const details = document.createElement("details");
  details.className = "popup-details";
  const summary = document.createElement("summary");
  summary.textContent = "Technische Kartendetails";
  details.append(summary);
  addParagraph(details, "Zusätzliche Angaben aus OpenStreetMap. Diese Einträge können unvollständig sein.");
  const list = document.createElement("dl");
  list.className = "popup-tags";
  for (const [key, value] of entries) {
    const term = document.createElement("dt"); term.textContent = key;
    const definition = document.createElement("dd"); definition.textContent = value;
    list.append(term, definition);
  }
  if (entries.length) details.append(list);
  else addParagraph(details, "Keine zusätzlichen Angaben erfasst.");

  const barriers = parseJson(values.barriers, []);
  const barrierTypes = {
    bollard: "Pfosten", gate: "Tor", lift_gate: "Schranke", wall: "Mauer", fence: "Zaun",
    stile: "Übersteighilfe", kissing_gate: "Drehtor", block: "Sperre",
  };
  if (barriers.length) {
    const heading = document.createElement("p");
    heading.className = "popup-subheading";
    heading.textContent = "Erfasste Hindernisse";
    details.append(heading);
    for (const node of barriers) {
      const nodeTags = Object.entries(node.tags || {}).map(([key, value]) => `${key}=${value}`).join(" · ");
      const paragraph = document.createElement("p");
      const evaluation = activeMode === "roadbike"
        ? ({ yes: "Keine Velosperre erfasst", no: "Laut Kartendaten gesperrt", review: "Vor Ort prüfen" }[node.status] || "Einstufung unklar")
        : "";
      const type = Object.hasOwn(barrierTypes, node.tags?.barrier) ? barrierTypes[node.tags.barrier] : "Hindernis";
      paragraph.textContent = `${type}${evaluation ? ` · ${evaluation}` : ""}${nodeTags ? ` · ${nodeTags}` : ""}`;
      if (/^\d+$/.test(node.osm)) {
        const link = document.createElement("a");
        link.href = `https://www.openstreetmap.org/node/${node.osm}`;
        link.textContent = `Kartenpunkt ${node.osm} öffnen`;
        link.target = "_blank"; link.rel = "noopener";
        paragraph.append(" · ", link);
      }
      details.append(paragraph);
    }
  }
  parent.append(details);
}

function addOsmPopup(panel, values) {
  const section = document.createElement("section");
  section.className = "osm-popup";
  const tags = parseJson(values.tags, {});
  const wayTypes = {
    cycleway: "Veloweg", footway: "Fussweg", path: "Weg", track: "Feld- oder Waldweg",
    steps: "Treppe", pedestrian: "Fussgängerbereich", residential: "Quartierstrasse",
    service: "Zufahrtsweg", primary: "Hauptstrasse", secondary: "Hauptstrasse",
    tertiary: "Nebenstrasse", trunk: "Übergeordnete Strasse", motorway: "Autobahn",
  };
  const title = document.createElement("h2");
  title.tabIndex = -1;
  title.textContent = values.name || (Object.hasOwn(wayTypes, tags.highway) ? wayTypes[tags.highway] : "Weg ohne Namen");
  section.append(title);
  const source = document.createElement("p");
  source.className = "popup-source";
  source.textContent = "Angaben aus OpenStreetMap";
  section.append(source);

  const facts = document.createElement("dl");
  facts.className = "popup-facts";
  addAccessFacts(facts, tags);
  if (activeMode === "roadbike") {
    const assessments = {
      yes: "Laut Kartendaten für Rennvelo geeignet",
      review: "Angaben unklar – bitte vor Ort prüfen",
      no: "Nicht als Rennvelo-Abschnitt eingestuft",
    };
    const state = Object.hasOwn(assessments, values.status) ? values.status : "review";
    const verdict = document.createElement("p");
    verdict.className = `popup-status popup-status--${state}`;
    verdict.textContent = assessments[state] || assessments.review;
    section.append(verdict);
    const reason = describeReason(values.reason);
    if (reason) addParagraph(section, reason);
    const directions = {
      both: "In beide Richtungen", forward: "Nur in eine Richtung; Richtungspfeile ab Zoomstufe 14",
      reverse: "Nur in eine Richtung; Richtungspfeile ab Zoomstufe 14", none: "Laut Karte in keiner Richtung freigegeben",
      review: "Nicht eindeutig angegeben",
    };
    addFact(facts, "Fahrtrichtung", Object.hasOwn(directions, values.direction) ? directions[values.direction] : "Nicht angegeben");
    addFact(facts, "Belag", describeSurface(tags));
  } else {
    const foot = {
      yes: "Laut Kartendaten zu Fuss zugänglich", review: "Zugang zu Fuss unklar – bitte vor Ort prüfen",
      no: "Laut Kartendaten nicht zu Fuss zugänglich",
    };
    const state = Object.hasOwn(foot, values.foot_status) ? values.foot_status : "review";
    const verdict = document.createElement("p");
    verdict.className = `popup-status popup-status--${state}`;
    verdict.textContent = foot[state] || foot.review;
    section.append(verdict);
    const runSurface = { paved: "Befestigt", unpaved: "Unbefestigt", unknown: "Unklar oder nicht eingeteilt" };
    addFact(facts, "Belag", Object.hasOwn(runSurface, values.run_surface) ? runSurface[values.run_surface] : "Unklar oder nicht eingeteilt");
  }
  addFact(facts, "Steigung oder Gefälle", describeGrade(values.grade, values.height));
  const barriers = parseJson(values.barriers, []);
  addFact(facts, "Hindernisse", barriers.length
    ? `${barriers.length} ${barriers.length === 1 ? "Eintrag" : "Einträge"} erfasst – Details unten`
    : "Keine eingetragen");
  section.append(facts);
  const note = document.createElement("p");
  note.className = "popup-note";
  note.textContent = "Kartendaten können unvollständig sein. Bitte Hinweise und Schilder vor Ort beachten.";
  section.append(note);
  addRawTags(section, values);
  if (/^\d+$/.test(values.osm)) {
    const link = document.createElement("a");
    link.href = `https://www.openstreetmap.org/way/${values.osm}`;
    link.className = "popup-link";
    link.textContent = "Diesen Weg in OpenStreetMap ansehen";
    link.target = "_blank"; link.rel = "noopener";
    section.append(link);
  }
  panel.append(section);
}

function describeSurface(tags) {
  const surfaces = {
    asphalt: "Asphalt", concrete: "Beton", "concrete:plates": "Betonplatten", "concrete:lanes": "Betonspuren",
    paved: "Befestigt",
    paving_stones: "Pflastersteine", sett: "Kopfsteinpflaster", cobblestone: "Kopfsteinpflaster",
    unhewn_cobblestone: "Grobpflaster", pebblestone: "Kieselsteine", grass_paver: "Rasengittersteine",
    unpaved: "Unbefestigt", compacted: "Verdichteter Untergrund", fine_gravel: "Feiner Kies",
    gravel: "Kies oder Schotter", ground: "Erde", dirt: "Erde", earth: "Erde",
    grass: "Gras", sand: "Sand", mud: "Schlamm", woodchips: "Holzschnitzel",
  };
  if (Object.hasOwn(surfaces, tags.surface)) return surfaces[tags.surface];
  const tracktypes = {
    grade1: "Fest (Stufe 1 von 5)", grade2: "Überwiegend fest (Stufe 2 von 5)",
    grade3: "Teils fest, teils weich (Stufe 3 von 5)", grade4: "Überwiegend weich (Stufe 4 von 5)",
    grade5: "Weich (Stufe 5 von 5)",
  };
  if (Object.hasOwn(tracktypes, tags.tracktype)) return tracktypes[tags.tracktype];
  if (tags.surface || tags.tracktype) return "Weitere Belagangabe erfasst (Details öffnen)";
  return "In OpenStreetMap nicht angegeben";
}

function describeGrade(grade, height) {
  if (grade != null) return `Etwa ${Math.abs(grade).toFixed(1).replace(".", ",")} % im Durchschnitt (Abschnitt bis 100 m)`;
  if (height === "Bauwerk – Höhe prüfen") return "Bei Brücken und Tunneln nicht aus Geländedaten ableitbar";
  if (height === "Nicht berechnet – ausserhalb Fuss-/Rennvelo-Netz") return "Für diesen Weg nicht berechnet";
  return "Keine verlässlichen Höhendaten";
}

function describeReason(reason) {
  if (!reason) return "";
  if (reason.includes("Belag nicht ausreichend erfasst")) return "Der Belag ist in der Karte nicht genau beschrieben.";
  if (reason.includes("Velofreigabe bei highway=trunk")) return "Ob Velos auf dieser Strasse fahren dürfen, ist aus den Kartendaten nicht klar.";
  if (reason.includes("Zugang oder Fahrtrichtung") || reason.includes("Zugang unklar") || reason.includes("Sperre/Hindernis prüfen")) return "Angaben zu Zugang, Fahrtrichtung oder Hindernissen sind unklar.";
  if (reason.includes("Hindernis prüfen")) return "Ein mögliches Hindernis ist eingetragen; bitte vor Ort prüfen.";
  if (reason.includes("Hindernis")) return "Ein Hindernis ist eingetragen; bitte vor Ort prüfen.";
  if (reason.includes("Sperre:")) return "Der Zugang ist laut Kartendaten eingeschränkt.";
  if (reason.includes("Autobahn/Autostrasse")) return "In OpenStreetMap als Autobahn oder Autostrasse markiert.";
  if (reason.includes("Treppe")) return "In OpenStreetMap als Treppe markiert.";
  if (reason.includes("Bau oder Planung")) return "Laut OpenStreetMap im Bau oder geplant.";
  if (reason.includes("Unbefestigt")) return "Der Belag ist unbefestigt oder als ungeeignet eingestuft.";
  return "";
}

function openSegmentPopup(feature, lngLat, focusTitle = false) {
  const panel = document.createElement("div");
  addOsmPopup(panel, feature.properties);
  new maplibregl.Popup({ maxWidth: "360px", focusAfterOpen: !focusTitle })
    .setLngLat(lngLat).setDOMContent(panel).addTo(map);
  if (focusTitle) panel.querySelector("h2")?.focus();
}

map.on("click", (event) => {
  if (!map.getLayer("roadbike-hit")) return;
  const p = event.point;
  const feature = map.queryRenderedFeatures([[p.x - 4, p.y - 4], [p.x + 4, p.y + 4]], { layers: ["roadbike-hit"] })[0];
  if (feature) openSegmentPopup(feature, event.lngLat);
});

inspectSegment.addEventListener("click", () => {
  const center = map.project(map.getCenter());
  const feature = map.queryRenderedFeatures(
    [[center.x - 12, center.y - 12], [center.x + 12, center.y + 12]],
    { layers: ["roadbike-hit"] },
  )[0];
  if (!feature) {
    inspectStatus.textContent = "Kein Wegabschnitt in Kartenmitte gefunden. Karte verschieben oder näher heranzoomen und erneut versuchen.";
    return;
  }
  openSegmentPopup(feature, map.getCenter(), true);
  inspectStatus.textContent = "Wegabschnitt gefunden. Details sind geöffnet.";
});
