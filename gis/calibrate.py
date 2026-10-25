"""Compare old HFM GPX elevations with local DTM. Run with uv run gis/calibrate.py."""

import argparse
import bisect
import csv
import json
import math
import os
from pathlib import Path
import statistics
import subprocess
import urllib.request
import xml.etree.ElementTree as ET

GIS = Path(__file__).resolve().parent
URL = "https://raw.githubusercontent.com/fuermenschen/hfm/refs/heads/main/resources/files/hfm_strecke.gpx"


def distance(a, b):
    lat1, lat2 = map(math.radians, (a[1], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2
    return 12742000 * math.asin(min(1, math.sqrt(h)))


def interpolate(xs, ys, x):
    i = max(0, min(len(xs) - 2, bisect.bisect_right(xs, x) - 1))
    return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i])


def metrics(xs, heights, window):
    # Compare heights across a physical window; never label pixel-to-pixel noise as max grade.
    grades = [100 * (interpolate(xs, heights, x + window) - z) / window
              for x, z in zip(xs, heights) if x + window <= xs[-1]]
    changes = [b - a for a, b in zip(heights, heights[1:])]
    return {"gain_m": sum(max(0, d) for d in changes),
            "loss_m": sum(max(0, -d) for d in changes),
            "max_uphill_grade_pct": max(grades),
            "max_downhill_grade_pct": min(grades)}


def smooth(xs, heights, window):
    return [statistics.mean(z for d, z in zip(xs, heights) if abs(d - x) <= window / 2)
            for x in xs]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dtm", type=Path)
    parser.add_argument("--spacing", type=float, default=5)
    parser.add_argument("--grade-window", type=float, default=20)
    args = parser.parse_args()
    if not all(math.isfinite(v) and v > 0 for v in (args.spacing, args.grade_window)):
        parser.error("spacing and grade-window must be positive finite metres")
    candidates = list((GIS / "input").glob("dtm_*.vrt"))
    if args.dtm is None and len(candidates) != 1:
        parser.error("provide --dtm when there is not exactly one local DTM mosaic")
    dtm = args.dtm or candidates[0]
    gpx = GIS / "input" / "hfm_strecke.gpx"
    if not gpx.exists():
        gpx.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL, timeout=60) as response:
            contents = response.read()
        ET.fromstring(contents)
        partial = gpx.with_suffix(".gpx.part")
        partial.write_bytes(contents)
        partial.replace(gpx)
    segments = ET.parse(gpx).findall(".//{*}trkseg")
    if len(segments) != 1:
        parser.error("reference must contain one continuous track segment")
    points = []
    for point in segments[0].findall("{*}trkpt"):
        ele = point.find("{*}ele")
        if ele is None or ele.text is None:
            parser.error("reference track needs elevation at every point")
        p = (float(point.attrib["lon"]), float(point.attrib["lat"]), float(ele.text))
        if not all(math.isfinite(v) for v in p):
            parser.error("non-finite GPX coordinate/elevation")
        if not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90):
            parser.error("GPX coordinates outside WGS84 bounds")
        if not points or distance(points[-1], p) > 0.001:
            points.append(p)
    if len(points) < 2:
        parser.error("reference needs at least two distinct points")
    xs = [0.0]
    for a, b in zip(points, points[1:]):
        xs.append(xs[-1] + distance(a, b))
    if args.grade_window >= xs[-1]:
        parser.error("grade window must be shorter than route")
    samples = [i * args.spacing for i in range(math.ceil(xs[-1] / args.spacing))] + [xs[-1]]
    coords = [(interpolate(xs, [p[0] for p in points], x),
               interpolate(xs, [p[1] for p in points], x)) for x in samples]
    app = Path(os.environ.get("QGIS_APP", "/Applications/QGIS.app"))
    env = os.environ.copy()
    resources = app / "Contents/Resources/qgis"
    if resources.exists():
        env.update(GDAL_DATA=str(resources / "gdal"), PROJ_DATA=str(resources / "proj"))
    def tool(name):
        bundled = app / "Contents/MacOS" / name
        return str(bundled) if bundled.exists() else name
    info = json.loads(subprocess.check_output([tool("gdalinfo"), "-json", str(dtm)], env=env))
    nodata = info["bands"][0].get("noDataValue")
    result = subprocess.run([tool("gdallocationinfo"), "-wgs84", "-valonly", "-b", "1",
                             "-r", "bilinear", str(dtm)],
                            input="".join(f"{lon} {lat}\n" for lon, lat in coords),
                            text=True, capture_output=True, check=True, env=env)
    heights = [float(line) if line.strip() else math.nan for line in result.stdout.splitlines()]
    if len(heights) != len(samples) or any(not math.isfinite(h) or h == nodata for h in heights):
        raise ValueError("DTM has missing samples; refusing to calculate ascent across gaps")
    gpx_heights = [interpolate(xs, [p[2] for p in points], x) for x in samples]
    errors = [a - b for a, b in zip(heights, gpx_heights)]
    profiles = {str(window): metrics(samples, smooth(samples, heights, window), args.grade_window)
                for window in (0, 10, 20)}
    summary = {"gpx_source": URL, "dtm": str(dtm), "distance_m": xs[-1],
               "gpx_points": len(points), "sample_spacing_m": args.spacing,
               "grade_window_m": args.grade_window,
               "gpx_raw": metrics(xs, [p[2] for p in points], args.grade_window),
               "dtm_by_smoothing_window_m": profiles,
               "dtm_minus_gpx_mean_m": statistics.mean(errors),
               "dtm_minus_gpx_rmse_m": math.sqrt(statistics.mean(e * e for e in errors)),
               "notes": ["GPX elevations are comparison data, not ground truth.",
                         "DTM is terrain height; bridges/tunnels require separate verification.",
                         "No automatic vertical offset or tuning to force GPX agreement."]}
    out = GIS / "work" / "calibration"
    out.mkdir(parents=True, exist_ok=True)
    with (out / "profile.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["distance_m", "longitude", "latitude", "gpx_elevation_m", "dtm_elevation_m"])
        writer.writerows((x, *coord, g, h) for x, coord, g, h in zip(samples, coords, gpx_heights, heights))
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    print("Outputs:", out)


if __name__ == "__main__":
    main()
