# First roadbike map

```sh
uv run gis/build_map.py --self-test
uv run gis/build_map.py
uv run gis/serve.py
```

Open http://127.0.0.1:8100. Python's basic `http.server` does not supply PMTiles byte ranges; this preview uses a standard range-capable handler.

`build_map.py` uses cached OSM roads, original Switzerland PBF (to retain actual barrier-node membership), and DTM mosaic. It does not use the previous `route_segments.gpkg` or QGIS project. QGIS-bundled `ogr2ogr` exports PMTiles directly; `pmtiles verify` validates it. `uv` manages Python dependencies from inline metadata.

Output: **`site/data/roads.pmtiles`**. Commit that generated archive with the static site; the existing Pages workflow uploads `site/` on each push to `main` and checks the archive is present. Raw inputs and intermediates stay under ignored `gis/input/` and `gis/work/`. No backend or CI data rebuild. Current data extent remains unchanged.

## Reading the map

- Solid lines: paved, bicycle-accessible according to OSM and map defaults. Includes cobbles/paving stones.
- Colour: magnitude of approximate mean terrain gradient over each piece (up to 100 m). It is not instantaneous or maximum slope.
- Arrows at zoom 14+: permitted bicycle direction, including reverse one-way and bicycle contraflow exceptions.
- Optional dashed grey lines: unresolved surface, access condition or physical barrier. Only with «Unklare Abschnitte zeigen» visible. Click for explanation.
- Grey solid lines: bicycle suitability retained, elevation unavailable (e.g. bridge/tunnel).
- Every OSM `highway=*` line in the build is clickable at map zoom 11+, including ways not shown as roadbike candidates. No highlight does not mean prohibition.

## Access and suitability

This is a **mapped-data roadbike candidate profile**, not a legal-access certificate or field survey. Raw relevant way tags and associated tagged barrier-node values are available in each OSM popup. Missing surface/access tags stay review cases. Stair ways remain clickable and are not treated as rideable roadbike sections.

The profile uses road-type defaults for ordinary roads, cycleways, paths and tracks; footways/pedestrian areas need cycling permission. Explicit bicycle tags take precedence over generic `vehicle`/`access`; `motor_vehicle=no` alone is not a bicycle ban. Private/destination access is not treated as unrestricted through access. Conditional rules on the effective access/direction tag remain review cases; a more-specific bicycle tag can override a generic condition. `oneway:bicycle` and opposite-cycleway exceptions are respected. `bicycle=discouraged` is review, not a ban.

Swiss VRV Art. 35 restricts Autobahnen and Autostrassen to motor vehicles capable of at least 80 km/h. OSM `highway=trunk` is not by itself proof that a way is legally an Autostrasse, so `trunk`/`trunk_link` without explicit bicycle permission are marked review, not automatically prohibited. OSM `motorroad=yes` and motorway tags are excluded from the roadbike candidate layer. The OSM access-default table is community guidance, not a legal register. Rules and runnable examples are in `bicycle.py`.

Relevant barrier/access nodes are read from original PBF and associated by exact OSM way membership. Their relevant raw tags are shown on the matching OSM feature; on candidate ways only adjacent pieces become review cases. A bollard or motor-vehicle-only ban does not block bicycles. Gates are reviewed even if legal cycle access is tagged, because physical passability is not established by that tag. No nearest-road transfer of restrictions. Obstacle data can be incomplete.

Elevation reuses calibrated 5 m sampling and 10 m smoothing. Missing terrain and bridge/tunnel surface heights are not fabricated. Typical access defaults are planning assumptions, not field surveys. Missing surface remains visibly unresolved rather than assumed asphalt.

Data: © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Derived archive: `site/data/roads.pmtiles`. Basemap: swisstopo and credited providers. Legal references: [VRV Art. 35](https://www.fedlex.admin.ch/eli/cc/1962/1364_1409_1420/de), [ASTRA cycling guidance](https://www.astra.admin.ch/de/verkehrssituationen), and [OSM access-default guidance](https://wiki.openstreetmap.org/wiki/Default_access_restrictions). The map does not grant event-use permission. Review local signs and suspect locations before final route selection.

The earlier analysis pipeline is replaced by this map build. Existing `gis/work/route_segments.gpkg` is not needed and is not published.
