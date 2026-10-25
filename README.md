# HFM Routenkarte

Static MapLibre site for planning roadbike and running routes around Winterthur. No application backend.

## Preview locally

```sh
python3 -m http.server 8000 --directory site
```

Open <http://localhost:8000>.

## Publish

The `pages.yml` workflow deploys `site/` on pushes to `main`. GitHub Pages is configured for Actions and custom domain `maps.fuer-menschen.ch`. Add a DNS CNAME for `maps` pointing to `fuermenschen.github.io`; enable HTTPS after GitHub provisions the certificate.

The basemap uses swisstopo's vector-tile Base Map style. GIS-produced route tiles will be added under `site/data/` after data preparation.
