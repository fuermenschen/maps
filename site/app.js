import * as maplibregl from "https://unpkg.com/maplibre-gl@6.3.0/dist/maplibre-gl.mjs";

const map = new maplibregl.Map({
  container: "map",
  style: "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json",
  attributionControl: {
    customAttribution:
      "© EDA, © BAFU, © BABS, © SAC, © Naturfreunde Schweiz, © opentransportdata.swiss",
  },
  center: [8.73, 47.5],
  zoom: 12,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(
  new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }),
  "bottom-left",
);
