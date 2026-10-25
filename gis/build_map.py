# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "affine>=2.4,<3",
#   "geopandas>=1.0,<2",
#   "numpy>=1.26,<3",
#   "osmium>=4,<5",
#   "pyogrio>=0.10,<1",
#   "pyproj>=3.6,<4",
#   "rasterio>=1.4,<2",
#   "shapely>=2,<3",
# ]
# ///
"""Build lean static roadbike overlay: uv run gis/build_map.py"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import time

import geopandas as gpd
import numpy as np
import osmium
from pyproj import Transformer
import rasterio
from shapely import Point, line_interpolate_point
from shapely.ops import substring

from bicycle import ALLOWED, BLOCKED, ORDINARY, PAVED, UNPAVED, TAG_KEYS, TAG_PREFIXES, assess, obstacle, check, source_tags
from running import ALLOWED as FOOT_ALLOWED, BLOCKED as FOOT_BLOCKED, FOOT_DEFAULT_YES, assess as assess_foot, check as check_foot

GIS = Path(__file__).resolve().parent
SAMPLE_SPACING_M = 5
SMOOTHING_WINDOW_M = 10
MAX_SEGMENT_LENGTH_M = 100


class Obstacles:
    def __init__(self, ids, bbox):
        self.ids, self.bbox, self.nodes, self.ways = ids, bbox, {}, {}

    def apply_file(self, path):
        processor = osmium.FileProcessor(str(path), osmium.osm.NODE | osmium.osm.WAY)
        processor = processor.with_filter(osmium.filter.KeyFilter(
            "barrier", "access", "access:conditional", "access:forward", "access:backward",
            "access:forward:conditional", "access:backward:conditional",
            "bicycle", "bicycle:conditional", "bicycle:forward", "bicycle:backward",
            "bicycle:forward:conditional", "bicycle:backward:conditional",
            "vehicle", "vehicle:conditional", "vehicle:forward", "vehicle:backward",
            "vehicle:forward:conditional", "vehicle:backward:conditional",
            "motor_vehicle", "motor_vehicle:conditional", "motor_vehicle:forward", "motor_vehicle:backward",
            "motor_vehicle:forward:conditional", "motor_vehicle:backward:conditional",
            "motorcar", "motorcar:conditional", "motorcar:forward", "motorcar:backward",
            "motorcar:forward:conditional", "motorcar:backward:conditional",
            "foot", "foot:conditional", "foot:forward", "foot:backward",
            "foot:forward:conditional", "foot:backward:conditional", "locked", "locked:conditional"
        ).enable_for(osmium.osm.NODE))
        processor = processor.with_filter(osmium.filter.IdFilter(self.ids).enable_for(osmium.osm.WAY))
        west, south, east, north = self.bbox
        ways_seen = 0
        for obj in processor:
            if obj.type_str() == "n":
                location = obj.location
                if west <= location.lon <= east and south <= location.lat <= north:
                    self.nodes[obj.id] = (location.lon, location.lat, dict(obj.tags))
            else:
                found = [node.ref for node in obj.nodes if node.ref in self.nodes]
                if found:
                    self.ways[obj.id] = found
                ways_seen += 1
                if ways_seen % 25000 == 0:
                    print(f"Matched OSM ways {ways_seen:,}/{len(self.ids):,}; tagged nodes in area {len(self.nodes):,}", flush=True)


def sample_profile(line, data, transform):
    xs = np.append(np.arange(0, line.length, SAMPLE_SPACING_M), line.length)
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
    half_window = SMOOTHING_WINDOW_M / 2
    left, right = np.searchsorted(xs, xs-half_window-1e-5), np.searchsorted(xs, xs+half_window+1e-5, side="right")
    return xs, np.array([np.mean(heights[a:b]) for a, b in zip(left, right)])


def needs_grade(roadbike_status, foot_status, highway):
    return highway != "steps" and (roadbike_status != "no" or foot_status != "no")


def file_metadata(path):
    path = Path(path).resolve()
    stat = path.stat()
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"file": path.relative_to(GIS.parent).as_posix(), "size_bytes": stat.st_size,
            "sha256": digest,
            "local_modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()}


def elevation_metadata(dtm_vrt, mosaic_resolution_m):
    return {
        "source": "Kanton Zürich DTM WCS",
        "source_url": "https://wms.zh.ch/DEMWCS",
        "coverage_id": dtm_vrt.stem,
        "product_survey_epoch": "2021/22",
        "product_metadata_resolution_m": 0.25,
        "wcs_coverage_advertised_resolution_m": 0.5,
        "mosaic_resolution_m": mosaic_resolution_m,
        "sample_spacing_m": SAMPLE_SPACING_M,
        "smoothing_window_m": SMOOTHING_WINDOW_M,
        "max_segment_length_m": MAX_SEGMENT_LENGTH_M,
        "grade_method": (
            "For accessible or review features in either view except stairs: bilinear DTM samples "
            f"every {SAMPLE_SPACING_M} m, "
            f"centred {SMOOTHING_WINDOW_M} m mean smoothing, then endpoint elevation difference "
            f"over each map segment (at most {MAX_SEGMENT_LENGTH_M} m). Not a surveyed road/deck grade."
        ),
    }


def command_version(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode:
        return None
    return result.stdout.strip() or result.stderr.strip() or None


def method_metadata(pbf, roads_file, dtm_files, osm_header, counts, foot_counts, archive, toolchain):
    tags = json.loads((GIS / "aoi.json").read_text())
    west, south, east, north = tags["wgs84_bbox"]
    corners = [Transformer.from_crs(4326, 2056, always_xy=True).transform(lon, lat)
               for lon, lat in ((west, south), (west, north), (east, south), (east, north))]
    source_files = [GIS / "osmconf.ini", GIS / "aoi.json", pbf, roads_file, *dtm_files]
    source_files = list(dict.fromkeys(Path(path).resolve() for path in source_files))
    dtm_vrt = next(Path(path) for path in dtm_files if Path(path).suffix.lower() == ".vrt")
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "toolchain": toolchain,
        "area_of_interest": {
            "description": tags["description"], "geometry": "axis-aligned bounding box",
            "bounds_wgs84": [west, south, east, north],
            "approx_size_km": tags["approx_size_km"],
            "bounds_lv95": [min(x for x, _ in corners), min(y for _, y in corners),
                            max(x for x, _ in corners), max(y for _, y in corners)],
        },
        "osm": {
            "source": "Geofabrik Switzerland extract",
            "source_url": "https://download.geofabrik.de/europe/switzerland.html",
            "snapshot_at": osm_header.get("osmosis_replication_timestamp"),
            "generator": osm_header.get("generator"),
            "extract_config": {"all_tags": True, "ignored_tag_keys": ["created_by", "converted_by", "source", "time", "ele", "note", "todo", "openGeoDB:", "fixme", "FIXME"]},
            "popup_tag_keys": {"exact": sorted(TAG_KEYS), "prefixes": sorted(TAG_PREFIXES)},
            "roadbike_defaults": {
                "ordinary_access_yes": sorted(ORDINARY | {"cycleway", "path", "track"}),
                "bicycle_permission_required": ["footway", "pedestrian", "bridleway"],
                "review_highway": ["trunk", "trunk_link", "other unclassified highway types"],
                "excluded_highway": ["motorway", "motorway_link", "construction", "proposed", "steps"],
                "explicit_allowed_values": sorted(ALLOWED), "excluded_access_values": sorted(BLOCKED),
                "motorroad_yes": "excluded; motor_vehicle=no alone does not deny bicycle access",
                "conditional_rules": "not evaluated; effective conditional access or direction remains review",
                "surface_paved": sorted(PAVED), "surface_unpaved": sorted(UNPAVED),
            },
            "running_defaults": {
                "foot_access_yes": sorted(FOOT_DEFAULT_YES),
                "explicit_allowed_values": sorted(FOOT_ALLOWED),
                "excluded_access_values": sorted(FOOT_BLOCKED),
                "trunk_or_cycleway_without_foot_permission": "review",
                "surface_classes": ["paved", "unpaved", "unknown"],
                "score": None,
            },
        },
        "elevation": elevation_metadata(dtm_vrt, tags["dtm_resolution_m"]),
        "datasets": {
            "used": ["OpenStreetMap road/access data within configured bbox", "Kanton Zürich DTM WCS"],
            "downloaded_not_used": [{
                "name": "Kanton Zürich Veloinfrastruktur",
                "source_url": "https://maps.zh.ch/wfs/VeloinfrastrukturZHWFS",
                "cached_files": ["gis/input/velo_radwege.geojson", "gis/input/velo_radstreifen.geojson"],
                "reason": "Not included in published map.",
            }],
            "not_downloaded_or_used": ["swissTLM3D"],
        },
        "files": [file_metadata(path) for path in source_files],
        "feature_counts": {"total": sum(counts.values()), "roadbike_status": dict(counts),
                            "running_foot_access": dict(foot_counts)},
        "output": file_metadata(archive),
        "known_limitations": [
            "A mapped-data planning profile, not legal verification or field survey.",
            "Conditional access is not evaluated; unknown tags remain review cases.",
            "Barrier data is incomplete; only explicitly tagged nodes with exact way membership are considered.",
            "Missing surfaces, bridge decks, and tunnel grades are not inferred.",
            "Running view shows foot-accessible OSM network and mapped surface class; no running score or route legality.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        check()
        check_foot()
        assert needs_grade("no", "yes", "footway")
        assert needs_grade("yes", "no", "residential")
        assert not needs_grade("no", "no", "footway")
        assert not needs_grade("no", "yes", "steps")
        elevation = elevation_metadata(Path("dtm_test.vrt"), 5)
        assert elevation["sample_spacing_m"] == SAMPLE_SPACING_M
        assert elevation["smoothing_window_m"] == SMOOTHING_WINDOW_M
        assert elevation["max_segment_length_m"] == MAX_SEGMENT_LENGTH_M
        assert all(f"{value} m" in elevation["grade_method"] for value in
                   (SAMPLE_SPACING_M, SMOOTHING_WINDOW_M, MAX_SEGMENT_LENGTH_M))
        assert all(version(name) for name in
                   ("geopandas", "numpy", "pyogrio", "pyproj", "rasterio", "shapely", "osmium", "affine"))
        # Linear plane and nodata regression for bilinear sampling.
        from affine import Affine
        from shapely import LineString
        grid = np.tile(np.arange(30, dtype=float), (30, 1))
        xs, z = sample_profile(LineString([(1, 10), (21, 10)]), grid, Affine.identity())
        assert np.isfinite(z).all() and z[-1] > z[0]
        grid[:] = np.nan
        assert np.isnan(sample_profile(LineString([(1, 10), (21, 10)]), grid, Affine.identity())[1]).all()
        return
    started = time.perf_counter()
    roads = gpd.read_file(GIS / "work/osm_roads.gpkg", layer="osm_roads").explode(ignore_index=True)
    if roads.crs.to_epsg() != 2056: raise ValueError("Expected LV95 OSM input")
    bbox = json.loads((GIS / "aoi.json").read_text())["wgs84_bbox"]
    pbf = GIS / "input/switzerland-latest.osm.pbf"
    reader = osmium.io.Reader(str(pbf))
    osm_header = reader.header()
    osm_header = {key: osm_header.get(key) for key in ("osmosis_replication_timestamp", "generator")}
    reader.close()
    handler = Obstacles(set(int(i) for i in roads.osm_id), bbox)
    print("Reading tagged barrier nodes and selected OSM ways from cached PBF", flush=True)
    handler.apply_file(str(pbf))
    print(f"PBF scan done in {time.perf_counter()-started:.1f}s; {len(handler.nodes):,} tagged nodes, {len(handler.ways):,} ways with tagged nodes", flush=True)
    to_lv95 = Transformer.from_crs(4326, 2056, always_xy=True)
    to_wgs84 = Transformer.from_crs(2056, 4326, always_xy=True)
    nodes = {i: (Point(*to_lv95.transform(lon, lat)), tags) for i, (lon, lat, tags) in handler.nodes.items()}
    dtms = list((GIS / "input").glob("dtm_*.vrt"))
    if len(dtms) != 1: raise ValueError("Expected exactly one DTM mosaic")
    with rasterio.open(dtms[0]) as src:
        if src.crs.to_epsg() != 2056: raise ValueError("Expected LV95 DTM")
        data, transform = src.read(1, masked=True).filled(np.nan), src.transform
        dtm_files = [Path(path).resolve() for path in src.files]
    features, counts, foot_counts = [], Counter(), Counter()
    for index, row in enumerate(roads.itertuples(index=False), 1):
        if index % 5000 == 0:
            print(f"Building OSM features {index:,}/{len(roads):,} ({time.perf_counter()-started:.0f}s)", flush=True)
        tags = json.loads(row.all_tags) if isinstance(row.all_tags, str) else row.all_tags
        if not isinstance(tags, dict) or not tags.get("highway"): raise ValueError("Missing OSM tags")
        status, direction, reason = assess(tags)
        foot_status, run_surface = assess_foot(tags)
        grade_needed = needs_grade(status, foot_status, tags["highway"])
        line = row.geometry
        if line.is_empty or not line.is_valid or line.length <= 0: continue
        barriers = [(line.project(p), i, t, *obstacle(t)) for i in handler.ways.get(int(row.osm_id), [])
                    for p, t in [nodes[i]] if line.distance(p) < .2]
        structure = tags.get("bridge", "no") not in {"no", "0", "false", ""} or tags.get("tunnel", "no") not in {"no", "0", "false", ""}
        if not grade_needed:
            xs, heights = np.array([0., line.length]), np.array([np.nan, np.nan])
        else:
            xs, heights = sample_profile(line, data, transform)
        n = math.ceil(line.length / MAX_SEGMENT_LENGTH_M)
        for part in range(n):
            start, end = part*line.length/n, (part+1)*line.length/n
            state, explanation = status, reason
            # A blocked node prevents crossing; highlight adjacent pieces for review rather than
            # incorrectly declaring the entire way inaccessible from either end.
            nearby = [(node, source, result, why) for offset, node, source, result, why in barriers
                      if start-.1 <= offset <= end+.1]
            problems = [why for _, _, result, why in nearby if result != "yes"]
            if problems and status != "no":
                state = "review"
                explanation = "; ".join(filter(None, [reason, *problems]))
            if not grade_needed:
                grade, height = None, "Nicht berechnet – ausserhalb Fuss-/Rennvelo-Netz"
            else:
                a, b = np.interp([start, end], xs, heights)
                # Do not estimate slopes across missing samples or bridge/tunnel terrain.
                valid = not structure and np.isfinite(heights[(xs >= start-SAMPLE_SPACING_M) & (xs <= end+SAMPLE_SPACING_M)]).all() and np.isfinite([a,b]).all()
                grade = round(float(100*(b-a)/(end-start)), 1) if valid else None
                height = "Bauwerk – Höhe prüfen" if structure else "Geländehöhe" if valid else "Höhendaten fehlen"
            geometry = substring(line, start, end)
            coords = [[round(lon, 6), round(lat, 6)] for lon,lat in
                      (to_wgs84.transform(x,y) for x,y,*_ in geometry.coords)]
            features.append({"type": "Feature", "properties": {
                "kind": "osm", "osm": str(row.osm_id), "name": tags.get("name", ""), "status": state,
                "foot_status": foot_status, "run_surface": run_surface,
                "direction": direction, "grade": grade, "surface": tags.get("surface", "unbekannt"),
                "reason": explanation, "height": height,
                "tags": json.dumps(source_tags(tags), ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                "barriers": json.dumps([{"osm": str(node), "status": result, "reason": why,
                                         "tags": source_tags(source)}
                                        for node, source, result, why in nearby],
                                       ensure_ascii=False, sort_keys=True, separators=(",", ":"))},
                "geometry": {"type": "LineString", "coordinates": coords}})
            counts[state] += 1
            foot_counts[foot_status] += 1
    print(f"Writing {len(features):,} map features ({time.perf_counter()-started:.0f}s)", flush=True)
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
    print("Converting GeoJSON to PMTiles", flush=True)
    ogr2ogr = str(bundled) if bundled.exists() else (shutil.which("ogr2ogr") or "ogr2ogr")
    pmtiles = shutil.which("pmtiles") or "pmtiles"
    toolchain = {
        "python": platform.python_version(),
        "packages": {name: version(name) for name in ("geopandas", "numpy", "pyogrio", "pyproj", "rasterio", "shapely", "osmium", "affine")},
        "external_tools": {
            "ogr2ogr": command_version([ogr2ogr, "--version"]),
            "pmtiles": command_version([pmtiles, "version"]),
        },
    }
    subprocess.run([ogr2ogr, "-f", "PMTiles",
                    "-dsco", "NAME=HFM Routenkarte",
                    "-dsco", "DESCRIPTION=OSM-derived roadbike and running views, ODbL; terrain grades are not surveyed road heights.",
                    "-nln", "roads", "-dsco", "MINZOOM=11", "-dsco", "MAXZOOM=16",
                    "-dsco", "MAX_SIZE=5000000", str(staging), str(output)], check=True, env=env)
    subprocess.run([pmtiles, "verify", str(staging)], check=True)
    staging.replace(archive)
    method = GIS.parent / "site/data/method.json"
    method_tmp = method.with_suffix(".json.part")
    method_tmp.write_text(json.dumps(method_metadata(pbf, GIS / "work/osm_roads.gpkg", dtm_files,
                                                     osm_header, counts, foot_counts, archive, toolchain),
                                    indent=2, ensure_ascii=False) + "\n")
    method_tmp.replace(method)
    print(json.dumps(dict(counts), indent=2))
    print(f"Running foot access: {dict(foot_counts)}")
    print(f"{archive}: {archive.stat().st_size / 1024**2:.1f} MiB; {len(handler.ways)} ways with tagged nodes")


if __name__ == "__main__": main()
