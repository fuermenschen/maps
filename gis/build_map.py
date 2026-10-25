# /// script
# requires-python = ">=3.12"
# dependencies = ["geopandas>=1.0,<2", "pyogrio>=0.10,<1", "rasterio>=1.4,<2", "osmium>=4,<5"]
# ///
"""Build lean static roadbike overlay: uv run gis/build_map.py"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import subprocess

import geopandas as gpd
import numpy as np
import osmium
from pyproj import Transformer
import rasterio
from shapely import Point, line_interpolate_point
from shapely.ops import substring

from bicycle import assess, obstacle, check

GIS = Path(__file__).resolve().parent


class Obstacles(osmium.SimpleHandler):
    def __init__(self, ids, bbox):
        super().__init__()
        self.ids, self.bbox, self.nodes, self.ways = ids, bbox, {}, {}

    def node(self, node):
        if not any(t.k.split(":")[0] in {"barrier", "access", "bicycle", "vehicle", "locked"} for t in node.tags):
            return
        west, south, east, north = self.bbox
        if west <= node.location.lon <= east and south <= node.location.lat <= north:
            self.nodes[node.id] = (node.location.lon, node.location.lat, dict(node.tags))

    def way(self, way):
        if way.id in self.ids:
            found = [n.ref for n in way.nodes if n.ref in self.nodes]
            if found: self.ways[way.id] = found


def sample_profile(line, data, transform):
    xs = np.append(np.arange(0, line.length, 5.), line.length)
    points = line_interpolate_point(line, xs)
    cols, rows = ~transform * (np.array([p.x for p in points]), np.array([p.y for p in points]))
    cols, rows = cols - .5, rows - .5
    c, r = np.floor(cols).astype(int), np.floor(rows).astype(int)
    valid = (r >= 0) & (c >= 0) & (r + 1 < data.shape[0]) & (c + 1 < data.shape[1])
    heights = np.full(len(xs), np.nan)
    rr, cc = r[valid], c[valid]
    dx, dy = cols[valid] - cc, rows[valid] - rr
    heights[valid] = ((1-dx)*(1-dy)*data[rr, cc] + dx*(1-dy)*data[rr, cc+1]
                     + (1-dx)*dy*data[rr+1, cc] + dx*dy*data[rr+1, cc+1])
    left, right = np.searchsorted(xs, xs-5.00001), np.searchsorted(xs, xs+5.00001, side="right")
    return xs, np.array([np.mean(heights[a:b]) for a, b in zip(left, right)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        check()
        # Linear plane and nodata regression for bilinear sampling.
        from affine import Affine
        from shapely import LineString
        grid = np.tile(np.arange(30, dtype=float), (30, 1))
        xs, z = sample_profile(LineString([(1, 10), (21, 10)]), grid, Affine.identity())
        assert np.isfinite(z).all() and z[-1] > z[0]
        grid[:] = np.nan
        assert np.isnan(sample_profile(LineString([(1, 10), (21, 10)]), grid, Affine.identity())[1]).all()
        return
    roads = gpd.read_file(GIS / "work/osm_roads.gpkg", layer="osm_roads").explode(ignore_index=True)
    if roads.crs.to_epsg() != 2056: raise ValueError("Expected LV95 OSM input")
    bbox = json.loads((GIS / "aoi.json").read_text())["wgs84_bbox"]
    handler = Obstacles(set(int(i) for i in roads.osm_id), bbox)
    print("Reading obstacle nodes and exact way memberships from cached PBF", flush=True)
    handler.apply_file(str(GIS / "input/switzerland-latest.osm.pbf"))
    to_lv95 = Transformer.from_crs(4326, 2056, always_xy=True)
    to_wgs84 = Transformer.from_crs(2056, 4326, always_xy=True)
    nodes = {i: (Point(*to_lv95.transform(lon, lat)), tags) for i, (lon, lat, tags) in handler.nodes.items()}
    dtms = list((GIS / "input").glob("dtm_*.vrt"))
    if len(dtms) != 1: raise ValueError("Expected exactly one DTM mosaic")
    with rasterio.open(dtms[0]) as src:
        if src.crs.to_epsg() != 2056: raise ValueError("Expected LV95 DTM")
        data, transform = src.read(1, masked=True).filled(np.nan), src.transform
    features, counts = [], Counter()
    for row in roads.itertuples(index=False):
        tags = json.loads(row.all_tags) if isinstance(row.all_tags, str) else row.all_tags
        if not isinstance(tags, dict) or not tags.get("highway"): raise ValueError("Missing OSM tags")
        status, direction, reason = assess(tags)
        if status == "no":
            counts["excluded_ways"] += 1
            continue
        line = row.geometry
        if line.is_empty or not line.is_valid or line.length <= 0: continue
        barriers = [(line.project(p), *obstacle(t)) for i in handler.ways.get(int(row.osm_id), [])
                    for p, t in [nodes[i]] if line.distance(p) < .2]
        structure = tags.get("bridge", "no") not in {"no", "0", "false", ""} or tags.get("tunnel", "no") not in {"no", "0", "false", ""}
        xs, heights = sample_profile(line, data, transform)
        n = math.ceil(line.length / 100)
        for part in range(n):
            start, end = part*line.length/n, (part+1)*line.length/n
            state, explanation = status, reason
            # A blocked node prevents crossing; highlight adjacent pieces for review rather than
            # incorrectly declaring the entire way inaccessible from either end.
            problems = [why for offset, result, why in barriers if start-.1 <= offset <= end+.1 and result != "yes"]
            if problems:
                state = "review"
                explanation = "; ".join(filter(None, [reason, *problems]))
            a, b = np.interp([start, end], xs, heights)
            # Do not estimate slopes across missing samples or bridge/tunnel terrain.
            valid = not structure and np.isfinite(heights[(xs >= start-5) & (xs <= end+5)]).all() and np.isfinite([a,b]).all()
            grade = round(float(100*(b-a)/(end-start)), 1) if valid else None
            geometry = substring(line, start, end)
            coords = [[round(lon, 6), round(lat, 6)] for lon,lat in
                      (to_wgs84.transform(x,y) for x,y,*_ in geometry.coords)]
            features.append({"type": "Feature", "properties": {
                "osm": str(row.osm_id), "name": tags.get("name", ""), "status": state,
                "direction": direction, "grade": grade, "surface": tags.get("surface", "unbekannt"),
                "reason": explanation, "height": "Bauwerk – Höhe prüfen" if structure else "Geländehöhe" if valid else "Höhendaten fehlen"},
                "geometry": {"type": "LineString", "coordinates": coords}})
            counts[state] += 1
    output = GIS / "work/roads.geojson"
    content = {"type": "FeatureCollection", "features": features,
               "generated_at": datetime.now(timezone.utc).isoformat()}
    temporary = output.with_suffix(".geojson.part")
    temporary.write_text(json.dumps(content, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    temporary.replace(output)
    archive = GIS.parent / "site/data/roads.pmtiles"
    archive.parent.mkdir(parents=True, exist_ok=True)
    app = Path(os.environ.get("QGIS_APP", "/Applications/QGIS.app"))
    bundled = app / "Contents/MacOS/ogr2ogr"
    env = os.environ.copy()
    resources = app / "Contents/Resources/qgis"
    if resources.exists():
        env.update(GDAL_DATA=str(resources / "gdal"), PROJ_DATA=str(resources / "proj"))
    staging = archive.with_name("roads.building.pmtiles")
    staging.unlink(missing_ok=True)
    subprocess.run([str(bundled) if bundled.exists() else "ogr2ogr", "-f", "PMTiles",
                    "-dsco", "NAME=HFM Rennvelo",
                    "-dsco", "DESCRIPTION=OSM-derived roadbike planning overlay, ODbL; terrain grades, not surveyed road heights.",
                    "-nln", "roads", "-dsco", "MINZOOM=11", "-dsco", "MAXZOOM=16",
                    "-dsco", "MAX_SIZE=5000000", str(staging), str(output)], check=True, env=env)
    subprocess.run(["pmtiles", "verify", str(staging)], check=True)
    staging.replace(archive)
    print(json.dumps(dict(counts), indent=2))
    print(f"{archive}: {archive.stat().st_size / 1024**2:.1f} MiB; {len(handler.ways)} ways with tagged nodes")


if __name__ == "__main__": main()
