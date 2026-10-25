# Routenkarte Winterthur

```sh
uv run gis/build_map.py --self-test
uv run gis/build_map.py
uv run gis/serve.py
```

Open http://127.0.0.1:8100. Python's basic `http.server` does not supply PMTiles byte ranges; this preview uses a standard range-capable handler.

`build_map.py` uses cached OSM roads, original Switzerland PBF (for exact barrier-node membership and snapshot timestamp), and DTM mosaic. It generates both `site/data/roads.pmtiles` and `site/data/method.json`. QGIS-bundled `ogr2ogr` exports PMTiles directly; `pmtiles verify` validates it. `uv` manages Python dependencies from inline metadata.

Published area: current bbox [8.58, 47.38, 8.92, 47.63], approximately 25.5 × 27.8 km. Extent unchanged. Generated PMTiles and method metadata are committed with the static site; Pages uploads `site/`. Raw inputs/intermediates stay under ignored `gis/input/` and `gis/work/`; CI does not rebuild GIS data.

## Reading the map

- Solid lines: paved, bicycle-accessible according to OSM and map defaults. Includes cobbles/paving stones.
- Optional Neigung colors: magnitude of approximate mean terrain gradient over each piece (up to 100 m). It is not instantaneous or maximum slope.
- Arrows at zoom 14+: permitted bicycle direction, including reverse one-way and bicycle contraflow exceptions.
- Optional dashed grey lines: unresolved surface, access condition or physical barrier. Only with «Unklare Abschnitte zeigen» visible. Click for explanation.
- Grey solid lines: bicycle suitability retained, elevation unavailable (e.g. bridge/tunnel).
- Every OSM `highway=*` line in the build is clickable at map zoom 11+, including ways not shown as roadbike candidates. No highlight does not mean prohibition.
- **Laufen** view: OSM foot-access network, paved solid/unpaved dashed. Neigung colors are toggleable; surface line styles remain. No score or time estimate.
- Controls sit inside map; collapse Kartenoptionen summary to hide panel. Deckkraft slider fades basemap, including labels, below route lines.

## Access and suitability

This is a **mapped-data roadbike candidate profile**, not a legal-access certificate or field survey. Raw relevant way tags and associated tagged barrier-node values are available in each OSM popup. Missing surface/access tags stay review cases. Stair ways remain clickable and are not treated as rideable roadbike sections.

The **Laufen** view uses foot-specific and generic access tags with conservative defaults; `foot=*` takes precedence over `access=*`, while conditional and unknown access remains review. It shows foot-accessible OSM ways by mapped surface class only (befestigt, unbefestigt, unbekannt); there is no running score, route legality, or time estimate.

The roadbike profile uses road-type defaults for ordinary roads, cycleways, paths and tracks; footways/pedestrian areas need cycling permission. Explicit bicycle tags take precedence over generic `vehicle`/`access`; `motor_vehicle=no` alone is not a bicycle ban. Private/destination access is not treated as unrestricted through access. Conditional rules on the effective access/direction tag remain review cases; a more-specific bicycle tag can override a generic condition. `oneway:bicycle` and opposite-cycleway exceptions are respected. `bicycle=discouraged` is review, not a ban.

Swiss VRV Art. 35 restricts Autobahnen and Autostrassen to motor vehicles capable of at least 80 km/h. OSM `highway=trunk` is not by itself proof that a way is legally an Autostrasse, so `trunk`/`trunk_link` without explicit bicycle permission are marked review, not automatically prohibited. OSM `motorroad=yes` and motorway tags are excluded from the roadbike candidate layer. The OSM access-default table is community guidance, not a legal register. Rules and runnable examples are in `bicycle.py`.

Relevant barrier/access nodes are read from original PBF and associated by exact OSM way membership. Their relevant raw tags are shown on the matching OSM feature; on candidate ways only adjacent pieces become review cases. A bollard or motor-vehicle-only ban does not block bicycles. Gates are reviewed even if legal cycle access is tagged, because physical passability is not established by that tag. No nearest-road transfer of restrictions. Obstacle data can be incomplete.

## Sources and processing

Elevation input comes from [Kanton Zürich DTM WCS](https://wms.zh.ch/DEMWCS). WCS coverage advertises 0.5 m; product metadata identifies 2021/22 at 0.25 m. Current mosaic is resampled to 5 m; builder samples every 5 m, applies centred 10 m smoothing, then computes grade between segment endpoints over accessible roadbike or foot segments up to 100 m (except stairs). These are terrain grades, not surveyed road/deck grades. See `site/data/method.json` for current source timestamps, AOI bounds, checksums, and full settings.

The downloaded Kanton Zürich Veloinfrastruktur WFS is not used in published map. swissTLM3D is not used. Data gaps: unknown tags, incomplete barrier mapping, conditional rules not evaluated, and no field verification. Legal references: [VRV Art. 35](https://www.fedlex.admin.ch/eli/cc/1962/1364_1409_1420/de), [ASTRA cycling guidance](https://www.astra.admin.ch/de/verkehrssituationen), and [OSM access-default guidance](https://wiki.openstreetmap.org/wiki/Default_access_restrictions). © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Basemap: swisstopo and credited providers. Map does not grant event-use permission.

The earlier analysis pipeline is replaced by this map build. Existing `gis/work/route_segments.gpkg` is not needed and is not published.
