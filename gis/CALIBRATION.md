# Old-course elevation calibration

```sh
uv run --no-project python gis/calibrate.py
uv run --no-project python gis/test_calibrate.py
```

Downloads missing reference GPX into ignored `gis/input/`. Uses QGIS-bundled GDAL (or GDAL on PATH) to sample local DTM with bilinear interpolation every 5 m. Set `QGIS_APP` for another installation, or `--dtm path/to/mosaic.vrt` if several mosaics exist.

Outputs in ignored `gis/work/calibration/`:

- `profile.csv`: distance, coordinates, GPX and DTM elevations for inspection/charting.
- `summary.json`: ascent/descent, profile difference, and grades measured over a 20 m horizontal window. Grades follow GPX travel direction.

Reference run: 1,756.90 m, GPX raw ascent 48.70 m. Seven consecutive duplicate locations are removed (85 GPX points → 78 unique consecutive positions).

| DTM smoothing window | Ascent | Descent | Maximum uphill grade over 20 m |
|---|---:|---:|---:|
| None | 49.68 m | 49.70 m | 8.76% |
| 10 m | 48.87 m | 48.82 m | 8.46% |
| 20 m | 48.56 m | 48.57 m | 8.01% |

DTM minus interpolated GPX: mean −0.07 m, RMSE 0.23 m. GPX and DTM may share an elevation source; this agreement does not independently establish accuracy. No offset correction applied.

Use **10 m centred moving-average smoothing and 20 m grade window** as initial processing settings. These are explicit scale choices, not a fit forcing ascent to match GPX. Reported grades are not instantaneous maximum slopes and cannot directly verify the report's roughly 11% maximum.

Missing/non-finite terrain heights stop calculation; gaps are never bridged silently. Terrain does not represent bridge decks or tunnel surfaces. Structure-tag checks belong to segment processing; inspect those locations in QGIS before trusting their terrain-derived grades.
