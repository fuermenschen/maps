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
const colour = ["case", ["==", ["get", "grade"], null], "#727b85",
  ["step", ["abs", ["get", "grade"]], "#15805a", 3, "#8a9a26", 6, "#d88112", 10, "#c44136", 15, "#85268c"]];

map.on("load", () => {
  map.addSource("roads", {
    type: "vector",
    url: `pmtiles://${new URL("./data/roads.pmtiles", import.meta.url).href}`,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  });
  const source = { source: "roads", "source-layer": "roads", minzoom: 11 };
  map.addLayer({ id: "roadbike", type: "line", ...source,
    filter: ["==", ["get", "status"], "yes"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": colour, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 6] },
  });
  map.addLayer({ id: "roadbike-check", type: "line", ...source,
    filter: ["==", ["get", "status"], "review"],
    layout: { visibility: "none" },
    paint: { "line-color": "#666", "line-width": 2.5, "line-dasharray": [2, 2] },
  });
  map.addLayer({ id: "roadbike-hit", type: "line", ...source,
    filter: ["==", ["get", "status"], "yes"],
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
    filter: ["all", ["==", ["get", "status"], "yes"], ["in", ["get", "direction"], ["literal", ["forward", "reverse"]]]],
    layout: { "symbol-placement": "line", "symbol-spacing": 120,
      "icon-image": "bike-direction", "icon-size": .65, "icon-rotation-alignment": "map",
      "icon-keep-upright": false, "icon-rotate": ["case", ["==", ["get", "direction"], "reverse"], 180, 0] },
  });
  uncertain.addEventListener("change", () => {
    map.setLayoutProperty("roadbike-check", "visibility", uncertain.checked ? "visible" : "none");
    map.setFilter("roadbike-hit", uncertain.checked ? ["in", ["get", "status"], ["literal", ["yes", "review"]]] : ["==", ["get", "status"], "yes"]);
  });
  gradient.addEventListener("change", () => {
    map.setPaintProperty("roadbike", "line-color", gradient.checked ? colour : "#15805a");
    document.querySelector("#gradient-legend").hidden = !gradient.checked;
    document.querySelector("#plain-legend").hidden = gradient.checked;
  });
  uncertain.disabled = gradient.disabled = false;
  status.textContent = "Rennvelo · Belag und Zugang gemäss OSM";
});

map.on("error", (event) => {
  console.error(event.error);
  status.textContent = "Kartendaten konnten nicht geladen werden. Details in Browser-Konsole.";
});

map.on("click", (event) => {
  if (!map.getLayer("roadbike-hit")) return;
  const p = event.point;
  const feature = map.queryRenderedFeatures([[p.x - 4, p.y - 4], [p.x + 4, p.y + 4]], { layers: ["roadbike-hit"] })[0];
  if (!feature) return;
  const values = feature.properties;
  const panel = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = values.name || "Strasse / Weg";
  panel.append(title);
  const lines = [values.status === "yes" ? "Rennvelo: befahrbar gemäss Kartendaten" : "Befahrbarkeit prüfen",
    `Neigung: ${values.grade == null ? "unbekannt" : `ca. ${Math.abs(values.grade).toFixed(1)} % (Abschnitt bis 100 m)`}`,
    `Velo: ${{ both: "beide Richtungen", forward: "nur in Pfeilrichtung", reverse: "nur in Pfeilrichtung", none: "Richtung prüfen" }[values.direction]}`,
    `Belag: ${values.surface}`, values.reason, values.height];
  for (const text of lines.filter(Boolean)) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    panel.append(paragraph);
  }
  if (/^\d+$/.test(values.osm)) {
    const link = document.createElement("a");
    link.href = `https://www.openstreetmap.org/way/${values.osm}`;
    link.textContent = "Quelle: OpenStreetMap";
    link.target = "_blank"; link.rel = "noopener";
    panel.append(link);
  }
  new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(event.lngLat).setDOMContent(panel).addTo(map);
});
