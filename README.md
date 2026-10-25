# HFM Routenkarte

[Live map](https://maps.fuer-menschen.ch) · [GitHub repository](https://github.com/fuermenschen/maps)

Static Winterthur map for exploring roadbike and running routes. MapLibre renders swisstopo basemap with OSM-derived network overlays; no backend or automatic route planner.

## Use map

- **Rennvelo**: mapped roadbike candidates, direction arrows, optional uncertain sections, terrain-slope colors, and tiltable 3D terrain.
- **Laufen**: OSM foot-accessible network. Solid lines are paved; dashed lines unpaved; dotted lines have unknown surface. Toggle slope coloring independently. No running score or time estimate.
- 3D route overlays follow the ground model; bridge decks and tunnels are not modelled.
- Click any OSM street/path, including sections not highlighted as route candidates, to inspect relevant source tags and matched barrier nodes.
- **Methode & Daten** disclosure describes classifications, sources, and limitations. [`method.json`](site/data/method.json) contains input snapshots and SHA-256 checksums.

Map categories are planning aids, not legal access determinations or field surveys. Missing tags, conditional access, and incomplete barrier data can change what is usable on site.

## Build and preview

Build is local. GitHub Actions publishes committed `site/`; it does not download or rebuild GIS inputs.

Prerequisites:

- [`uv`](https://docs.astral.sh/uv/)
- QGIS/GDAL with `ogr2ogr` and `gdalbuildvrt`
- [`pmtiles`](https://docs.protomaps.com/pmtiles/cli) command-line tool

Builder needs these ignored local inputs:

- `gis/input/switzerland-latest.osm.pbf`: Switzerland extract from [Geofabrik](https://download.geofabrik.de/europe/switzerland.html).
- `gis/work/osm_roads.gpkg`, layer `osm_roads`, EPSG:2056, with `osm_id` and `all_tags` fields. Create from PBF using project config and current AOI:

  ```sh
  mkdir -p gis/input gis/work
  curl -L https://download.geofabrik.de/europe/switzerland-latest.osm.pbf -o gis/input/switzerland-latest.osm.pbf
  export QGIS_APP="/Applications/QGIS.app"
  export GDAL_DATA="$QGIS_APP/Contents/Resources/qgis/gdal"
  export PROJ_DATA="$QGIS_APP/Contents/Resources/qgis/proj"
  "$QGIS_APP/Contents/MacOS/ogr2ogr" -f GPKG -overwrite -nln osm_roads \
    -oo CONFIG_FILE=gis/osmconf.ini \
    -spat 8.58 47.38 8.92 47.63 -clipsrc 8.58 47.38 8.92 47.63 \
    -t_srs EPSG:2056 \
    -where "highway IS NOT NULL" \
    gis/work/osm_roads.gpkg gis/input/switzerland-latest.osm.pbf lines
  ```

- One DTM VRT named `gis/input/dtm_*.vrt`, plus its referenced GeoTIFF tiles. Obtain 5 m tiles from [Kanton Zürich DTM WCS](https://wms.zh.ch/DEMWCS); build mosaic VRT with `gdalbuildvrt gis/input/dtm_current.vrt gis/input/dtm_*.tif`. Builder expects EPSG:2056 and exactly one VRT.

Then run:

```sh
uv run gis/build_map.py --self-test
uv run gis/build_map.py
uv run gis/serve.py
```

Open <http://127.0.0.1:8100>. Preview server supports PMTiles byte ranges. Builder verifies archive and writes:

- `site/data/roads.pmtiles`
- `site/data/method.json`

Commit both generated files when refreshing map. Raw PBF, GeoPackage, and DTM inputs stay ignored under `gis/input/` and `gis/work/`. Set `QGIS_APP` to another QGIS app bundle if needed; without it, builder looks for `ogr2ogr` on `PATH`.

`method.json` records Python/package, `ogr2ogr`, and PMTiles versions. It fingerprints inputs (`gis/osmconf.ini`, `gis/aoi.json`, Switzerland PBF, roads GeoPackage, DTM VRT and backing files) by path, size, modification time, and SHA-256.

## Data and method

- AOI: existing bbox `[8.58, 47.38, 8.92, 47.63]`, approximately 25.5 × 27.8 km. Extent intentionally unchanged.
- Roadbike: OSM tags plus documented Swiss planning defaults. `highway=trunk` alone does not prove an Autostrasse; uncertain access stays review. See [`gis/MAP.md`](gis/MAP.md) and [`gis/bicycle.py`](gis/bicycle.py).
- Running: foot-specific access takes precedence over generic access; surface classes use `surface=*`. No score.
- Elevation: WCS coverage advertises 0.5 m; product metadata says 0.25 m, epoch 2021/22. Processing uses 5 m mosaic, 5 m sampling, 10 m centered smoothing, and grade per segment up to 100 m. Do not describe processing as 0.25 m.
- 3D terrain uses [Mapterhorn terrain tiles](https://mapterhorn.com/attribution) with 5× vertical exaggeration; route lines follow terrain, not bridge decks or tunnel surfaces.
- Kanton Zürich Veloinfrastruktur files exist in local cache but are not used in published map. swissTLM3D is not used.

See [`gis/MAP.md`](gis/MAP.md) for map interpretation and access defaults; [`gis/CALIBRATION.md`](gis/CALIBRATION.md) documents the elevation smoothing calibration.

OSM data © contributors, [ODbL](https://www.openstreetmap.org/copyright). Basemap © swisstopo and credited providers. Map does not establish legal access or event permission; verify local signs and conditions before use.

Project-authored code uses GPL-3.0-only (see [`LICENSE`](LICENSE)); OSM, elevation, and basemap data retain their own terms.
