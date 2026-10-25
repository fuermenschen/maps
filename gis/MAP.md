# First roadbike map

```sh
uv run gis/build_map.py --self-test
uv run gis/build_map.py
uv run gis/serve.py
```

Open http://127.0.0.1:8100. Python's basic `http.server` does not supply PMTiles byte ranges; this preview uses a standard range-capable handler.

`build_map.py` uses cached OSM roads, original Switzerland PBF (to retain actual barrier-node membership), and DTM mosaic. It does not use the previous `route_segments.gpkg`, official velo matching or QGIS project. QGIS-bundled `ogr2ogr` exports PMTiles directly; `pmtiles verify` validates it. `uv` manages Python dependencies from inline metadata.

Output: **`site/data/roads.pmtiles`**. Commit that generated archive with the static site; the existing Pages workflow uploads `site/` on each push to `main` and checks the archive is present. Raw inputs and intermediates stay under ignored `gis/input/` and `gis/work/`. No backend or CI data rebuild. Current data extent remains unchanged.

## Reading the map

- Solid lines: paved, bicycle-accessible according to OSM and Swiss road-type defaults. Includes cobbles/paving stones.
- Colour: magnitude of approximate mean terrain gradient over each piece (up to 100 m). It is not instantaneous or maximum slope.
- Arrows at zoom 14+: permitted bicycle direction, including reverse one-way and bicycle contraflow exceptions.
- Optional dashed lines: unresolved surface, access condition or physical barrier. Click for explanation.
- Grey solid lines: bicycle suitability retained, elevation unavailable (e.g. bridge/tunnel).
- Roads without highlighting are not automatically prohibited: underlying basemap remains context.

Road-type defaults apply to ordinary roads, cycleways, paths and tracks; footways/pedestrian areas require cycling permission. Motorways, Swiss trunk roads and motorroads are excluded. More-specific access tags override broader restrictions; motor-vehicle bans do not become bicycle bans. Private/destination access is excluded from unrestricted through-riding. Conditional bicycle rules remain review cases. `oneway:bicycle` exceptions and legacy opposite-cycleway tags are respected. Rules are in `bicycle.py` with runnable examples.

Relevant barrier/access nodes are read from original PBF and associated by exact OSM way membership. Only their adjacent map pieces become review cases. A bollard or motor-vehicle-only ban does not block bicycles. Gates are reviewed even if legal cycle access is tagged, because physical passability is not established by that tag. No nearest-road transfer of restrictions.

Elevation reuses calibrated 5 m sampling and 10 m smoothing. Missing terrain and bridge/tunnel surface heights are not fabricated. Typical access defaults are planning assumptions, not field surveys. Missing surface remains visibly unresolved rather than assumed asphalt.

Data: © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Derived data archive is downloadable at `site/data/roads.pmtiles`. Basemap: swisstopo and credited providers. The map does not grant event-use permission. Review known local bicycle exceptions and suspect locations before final route selection.

The earlier analysis pipeline is replaced by this map build. Existing `gis/work/route_segments.gpkg` is not needed and is not published.
