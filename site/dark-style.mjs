function recolor(value, property, layerId, parseColor) {
  if (Array.isArray(value)) return value.map((part) => recolor(part, property, layerId, parseColor));
  if (typeof value !== "string") return value;
  const color = parseColor(value);
  if (!color) return value;
  if (property === "background-color") return "#151a20";
  if (property === "text-halo-color" || property === "icon-halo-color") return "rgba(12, 17, 23, 0.92)";
  const [h, s, l, a] = toHsl(color);
  if (property === "text-color" || property === "icon-color") return fromHsl([h, Math.min(s, 0.8), Math.max(l, 0.82), a]);
  if (property.startsWith("hillshade-")) return fromHsl([h, Math.min(s, 0.35), property.includes("highlight") ? 0.42 : 0.12, a]);
  if (/(building|construct)/.test(layerId) && property === "fill-color") return fromHsl([h, Math.min(s, 0.45), 0.1 + l * 0.14, a]);
  if (/(building|construct)/.test(layerId) && ["line-color", "fill-outline-color"].includes(property)) {
    return fromHsl([h, Math.min(s, 0.45), 0.26 + l * 0.16, a]);
  }
  if (property === "line-color") return fromHsl([h, Math.min(s, 0.75), 0.36 + l * 0.28, a]);
  if (property === "fill-outline-color") return fromHsl([h, Math.min(s, 0.55), 0.28 + l * 0.2, a]);
  return fromHsl([h, Math.min(s, 0.65), 0.12 + l * 0.2, a]);
}

function toHsl([r, g, b, a]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return [(hue + 360) % 360, saturation, lightness, a / 255];
}

function fromHsl([h, s, l, a]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `rgba(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)}, ${a})`;
}

export function makeDarkStyle(source, parseColor) {
  const style = structuredClone(source);
  for (const layer of style.layers) {
    if (layer.paint) for (const [property, value] of Object.entries(layer.paint)) {
      if (property.includes("color")) layer.paint[property] = recolor(value, property, layer.id, parseColor);
    }
    if (layer.paint?.["fill-pattern"]) layer.paint["fill-opacity"] = 0.18;
    if (layer.type === "symbol" && layer.layout?.["icon-image"]) {
      layer.paint ||= {};
      layer.paint["icon-halo-color"] = "rgba(12, 17, 23, 0.92)";
      layer.paint["icon-halo-width"] = 1.25;
    }
  }
  return style;
}
