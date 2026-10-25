import * as maplibregl from "https://unpkg.com/maplibre-gl@6.3.0/dist/maplibre-gl.mjs";
import { Protocol } from "https://unpkg.com/pmtiles@4.5.0/dist/esm/index.js";

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

export const map = new maplibregl.Map({
  container: "map",
  style: "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json",
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

const status = document.querySelector(".status");
const uncertain = document.querySelector("#uncertain");
const gradient = document.querySelector("#gradient");
const opacity = document.querySelector("#basemap-opacity");
const opacityValue = document.querySelector("#basemap-opacity-value");
const modes = document.querySelectorAll('input[name="map-mode"]');
const colour = ["case", ["==", ["get", "grade"], null], "#727b85",
  ["step", ["abs", ["get", "grade"]], "#15805a", 3, "#8a9a26", 6, "#d88112", 10, "#c44136", 15, "#85268c"]];
let activeMode = "roadbike";
let routeSourceLoaded = false;
let routeSourceFailed = false;
let basemapFailed = false;

function updateStatus() {
  if (routeSourceFailed && basemapFailed) status.textContent = "Grundkarte und Routendaten konnten nicht geladen werden.";
  else if (routeSourceFailed) status.textContent = "Rennvelo-/Laufdaten konnten nicht geladen werden.";
  else if (basemapFailed && routeSourceLoaded) status.textContent = "Routendaten geladen; Grundkarte meldet einen Fehler.";
  else if (basemapFailed) status.textContent = "Grundkarte konnte nicht geladen werden.";
  else if (routeSourceLoaded) status.textContent = activeMode === "running" ? "Laufen · Fusszugang und Belag gemäss OSM" : "Rennvelo · Belag und Zugang gemäss OSM";
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

map.on("load", () => {
  map.addSource("roads", {
    type: "vector",
    url: `pmtiles://${new URL("./data/roads.pmtiles", import.meta.url).href}`,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  });
  map.addSource("basemap-fade", { type: "geojson", data: {
    type: "Feature", properties: {},
    geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] },
  } });
  map.addLayer({ id: "basemap-fade", type: "fill", source: "basemap-fade",
    paint: { "fill-color": "#f7f7f2", "fill-opacity": 0 },
  });
  const source = { source: "roads", "source-layer": "roads", minzoom: 11 };
  const osm = ["==", ["get", "kind"], "osm"];
  map.addLayer({ id: "roadbike", type: "line", ...source,
    filter: ["all", osm, ["==", ["get", "status"], "yes"]],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": colour, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 6] },
  });
  map.addLayer({ id: "roadbike-check", type: "line", ...source,
    filter: ["all", osm, ["==", ["get", "status"], "review"]],
    layout: { visibility: "none" },
    paint: { "line-color": "#666", "line-width": 2.5, "line-dasharray": [2, 2] },
  });
  map.addLayer({ id: "roadbike-hit", type: "line", ...source,
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
  map.addImage("bike-direction", context.getImageData(0, 0, 24, 24));
  map.addLayer({ id: "roadbike-direction", type: "symbol", ...source, minzoom: 14,
    filter: ["all", osm, ["==", ["get", "status"], "yes"], ["in", ["get", "direction"], ["literal", ["forward", "reverse"]]]],
    layout: { "symbol-placement": "line", "symbol-spacing": 120,
       "icon-image": "bike-direction", "icon-size": .65, "icon-rotation-alignment": "map",
       "icon-keep-upright": false, "icon-rotate": ["case", ["==", ["get", "direction"], "reverse"], 180, 0] },
  });
  const run = ["==", ["get", "foot_status"], "yes"];
  map.addLayer({ id: "run-paved", type: "line", ...source,
    filter: ["all", osm, run, ["==", ["get", "run_surface"], "paved"]],
    layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#2d6c89", "line-width": 3.5 },
  });
  map.addLayer({ id: "run-unpaved", type: "line", ...source,
    filter: ["all", osm, run, ["==", ["get", "run_surface"], "unpaved"]],
    layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#a65b18", "line-width": 3.5, "line-dasharray": [3, 3] },
  });
  map.addLayer({ id: "run-unknown", type: "line", ...source,
    filter: ["all", osm, run, ["==", ["get", "run_surface"], "unknown"]],
    layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#727b85", "line-width": 3, "line-dasharray": [1, 1] },
  });
  map.addLayer({ id: "run-check", type: "line", ...source,
    filter: ["all", osm, ["==", ["get", "foot_status"], "review"]],
    layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#666", "line-width": 2.5, "line-dasharray": [2, 2] },
  });
  const updateUnclear = () => {
    map.setLayoutProperty("roadbike-check", "visibility", activeMode === "roadbike" && uncertain.checked ? "visible" : "none");
    map.setLayoutProperty("run-check", "visibility", activeMode === "running" && uncertain.checked ? "visible" : "none");
  };
  const updateGradient = () => {
    const graded = gradient.checked ? colour : null;
    map.setPaintProperty("roadbike", "line-color", graded || "#15805a");
    map.setPaintProperty("run-paved", "line-color", graded || "#2d6c89");
    map.setPaintProperty("run-unpaved", "line-color", graded || "#a65b18");
    map.setPaintProperty("run-unknown", "line-color", graded || "#727b85");
    document.querySelector("#gradient-legend").hidden = !gradient.checked;
    document.querySelector("#plain-legend").hidden = gradient.checked || activeMode === "running";
  };
  const updateMode = () => {
    activeMode = document.querySelector('input[name="map-mode"]:checked').value;
    const running = activeMode === "running";
    for (const id of ["roadbike", "roadbike-direction"]) map.setLayoutProperty(id, "visibility", running ? "none" : "visible");
    for (const id of ["run-paved", "run-unpaved", "run-unknown"]) map.setLayoutProperty(id, "visibility", running ? "visible" : "none");
    document.querySelector("#roadbike-legend").hidden = running;
    document.querySelector("#running-legend").hidden = !running;
    updateUnclear();
    updateGradient();
    updateStatus();
  };
  modes.forEach((radio) => radio.addEventListener("change", updateMode));
  uncertain.addEventListener("change", () => {
    updateUnclear();
  });
  gradient.addEventListener("change", () => {
    updateGradient();
  });
  opacity.addEventListener("input", () => {
    const value = Number(opacity.value);
    opacityValue.value = `${value}%`;
    map.setPaintProperty("basemap-fade", "fill-opacity", 1 - value / 100);
  });
  updateMode();
  modes.forEach((radio) => { radio.disabled = false; });
  uncertain.disabled = gradient.disabled = false;
  opacity.disabled = false;
});

function parseJson(value, fallback) {
  try { return JSON.parse(value || ""); } catch { return fallback; }
}

function addParagraph(parent, text) {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  parent.append(paragraph);
}

function addRawTags(parent, values) {
  const tags = parseJson(values.tags, {});
  const entries = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b));
  const show = (label, keys, empty) => {
    const found = keys.filter((key) => Object.hasOwn(tags, key)).map((key) => `${key}=${tags[key]}`);
    addParagraph(parent, `${label}: ${found.join(" · ") || empty}`);
  };
  show("Belag", ["surface", "smoothness", "tracktype"], "nicht getaggt");
  const stepTags = ["step_count", "ramp", "handrail", "conveying"].filter((key) => Object.hasOwn(tags, key));
  if (tags.highway === "steps" || stepTags.length) {
    show("Treppen", ["highway", ...stepTags], "Treppenmerkmale nicht erfasst");
  } else {
    addParagraph(parent, "Treppen: keine Treppen-Tags erfasst");
  }
  show("Zugang / Verbote", entries.map(([key]) => key).filter((key) =>
    ["access", "bicycle", "vehicle", "motor_vehicle", "motorcar", "foot"].includes(key.split(":")[0])),
  "keine entsprechenden Tags erfasst");
  show("Richtung", entries.map(([key]) => key).filter((key) =>
    key === "oneway" || key.startsWith("oneway:") || key.startsWith("cycleway:") ||
    key === "bicycle:forward" || key === "bicycle:backward" ||
    key === "bicycle:forward:conditional" || key === "bicycle:backward:conditional"),
  "keine Richtungstags erfasst");

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `Relevante OSM-Tags (${entries.length})`;
  details.append(summary);
  const list = document.createElement("dl");
  for (const [key, value] of entries) {
    const term = document.createElement("dt"); term.textContent = key;
    const definition = document.createElement("dd"); definition.textContent = value;
    list.append(term, definition);
  }
  if (!entries.length) addParagraph(details, "Keine relevanten Tags erfasst.");
  else details.append(list);
  parent.append(details);

  const barriers = parseJson(values.barriers, []);
  if (barriers.length) {
    addParagraph(parent, "Zugeordnete Hindernisknoten:");
    for (const node of barriers) {
      const nodeTags = Object.entries(node.tags || {}).map(([key, value]) => `${key}=${value}`).join(" · ");
      const paragraph = document.createElement("p");
      const evaluation = activeMode === "roadbike" ? ` (${node.status}${node.reason ? `: ${node.reason}` : ""})` : "";
      paragraph.textContent = `Node ${node.osm}: ${nodeTags || "keine Tags"}${evaluation}`;
      if (/^\d+$/.test(node.osm)) {
        const link = document.createElement("a");
        link.href = `https://www.openstreetmap.org/node/${node.osm}`;
        link.textContent = " OSM"; link.target = "_blank"; link.rel = "noopener";
        paragraph.append(link);
      }
      parent.append(paragraph);
    }
  } else {
    addParagraph(parent, "Keine passenden, getaggten Hindernisknoten auf diesem OSM-Weg gefunden.");
  }
}

function addOsmPopup(panel, values) {
  const section = document.createElement("section");
  const title = document.createElement("strong");
  title.textContent = `${values.name || values.tags && parseJson(values.tags, {}).highway || "Strasse / Weg"} · OpenStreetMap`;
  section.append(title);
  const surface = { paved: "befestigt", unpaved: "unbefestigt", unknown: "unbekannt" };
  if (activeMode === "roadbike") {
    const labels = {
      yes: "Rennvelo-Kandidat gemäss Kartendaten",
      review: "Prüfen – Kartendaten unklar",
      no: "Nicht im Rennvelo-Profil markiert",
    };
    addParagraph(section, `Einordnung: ${labels[values.status] || "unbekannt"}`);
    if (values.reason) addParagraph(section, `Grund: ${values.reason}`);
    addParagraph(section, `Neigung: ${values.grade == null ? values.height || "unbekannt" : `ca. ${Math.abs(values.grade).toFixed(1)} % (Abschnitt bis 100 m)`}`);
    const directions = { both: "beide Richtungen", forward: "OSM-Wayrichtung", reverse: "gegen OSM-Wayrichtung", none: "keine", review: "prüfen" };
    addParagraph(section, `Velo-Richtung: ${directions[values.direction] || "unbekannt"}`);
  } else {
    const foot = { yes: "zugänglich gemäss Kartendaten", review: "Zugang prüfen", no: "nicht im Laufnetz" };
    addParagraph(section, `Laufen: ${foot[values.foot_status] || "Zugang prüfen"}; Belag ${surface[values.run_surface] || "unbekannt"}`);
    addParagraph(section, `Neigung: ${values.grade == null ? values.height || "unbekannt" : `ca. ${Math.abs(values.grade).toFixed(1)} % (Abschnitt bis 100 m)`}`);
  }
  addRawTags(section, values);
  if (/^\d+$/.test(values.osm)) {
    const link = document.createElement("a");
    link.href = `https://www.openstreetmap.org/way/${values.osm}`;
    link.textContent = "OSM-Weg öffnen";
    link.target = "_blank"; link.rel = "noopener";
    section.append(link);
  }
  panel.append(section);
}

map.on("click", (event) => {
  if (!map.getLayer("roadbike-hit")) return;
  const p = event.point;
  const feature = map.queryRenderedFeatures([[p.x - 4, p.y - 4], [p.x + 4, p.y + 4]], { layers: ["roadbike-hit"] })[0];
  if (!feature) return;
  const panel = document.createElement("div");
  addOsmPopup(panel, feature.properties);
  new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(event.lngLat).setDOMContent(panel).addTo(map);
});
