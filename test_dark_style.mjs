import assert from "node:assert/strict";
import { makeDarkStyle } from "./site/dark-style.mjs";

const parseRgb = (value) => {
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  return match ? [+match[1], +match[2], +match[3], Math.round((match[4] == null ? 1 : +match[4]) * 255)] : null;
};
const lightness = (color) => {
  const [, r, g, b] = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return (Math.max(+r, +g, +b) + Math.min(+r, +g, +b)) / 510;
};
const source = {
  version: 8,
  sources: { base: { type: "vector", url: "https://example.test/tiles.json" } },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "rgb(252,252,252)" } },
    { id: "building", type: "fill", paint: { "fill-color": ["step", ["zoom"], "rgb(255,255,255)", 16, "rgb(230,230,230)"] } },
    { id: "landuse", type: "fill", paint: { "fill-color": "rgb(255,255,255)" } },
    { id: "roads", type: "line", paint: { "line-color": "rgb(255,230,160)" } },
    { id: "labels", type: "symbol", layout: { "icon-image": "poi" }, paint: { "text-color": "rgb(64,64,64)" } },
    { id: "landcover-pattern", type: "fill", paint: { "fill-pattern": "forest", "fill-opacity": 1 } },
  ],
};
const dark = makeDarkStyle(source, parseRgb);
assert.equal(source.layers[0].paint["background-color"], "rgb(252,252,252)");
assert.equal(dark.layers[0].paint["background-color"], "#151a20");
const buildingStops = dark.layers[1].paint["fill-color"];
assert.notEqual(buildingStops[2], "rgb(255,255,255)");
assert.ok(lightness(buildingStops[2]) < lightness(dark.layers[2].paint["fill-color"]));
assert.ok(lightness(buildingStops[4]) < lightness(dark.layers[2].paint["fill-color"]));
assert.notEqual(dark.layers[3].paint["line-color"], "rgb(255,230,160)");
assert.match(dark.layers[4].paint["text-color"], /rgba\(\d+, \d+, \d+, 1\)/);
assert.equal(dark.layers[4].paint["icon-halo-width"], 1.25);
assert.equal(dark.layers[5].paint["fill-opacity"], 0.18);
assert.deepEqual(dark.sources, source.sources);
console.log("Dark style transformation checks passed");
