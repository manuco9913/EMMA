# frontend/public — Static Assets

Static files served by Vite's dev server and included in production builds.
Large binary assets are excluded from git and must be downloaded separately.

---

## tiles/tiles.pmtiles

Vector tile archive using the [Protomaps](https://protomaps.com) basemap schema (zoom 0–10).

**Download:** https://maps.protomaps.com/builds/ — pick the latest `*.pmtiles` build
(global extract, ~500 MB). Rename or symlink it to `tiles/tiles.pmtiles`.

Alternatively, extract a regional excerpt with [pmtiles CLI](https://github.com/protomaps/go-pmtiles):

```
pmtiles extract https://build.protomaps.com/20240101.pmtiles tiles/tiles.pmtiles \
  --bbox="-10,49,2,61"   # UK + Ireland example
```

---

## fonts/{fontstack}/{range}.pbf

Glyph PBF files required for map text labels. The `style.json` references
`/fonts/{fontstack}/{range}.pbf`. Without these files the map renders without labels.

**Download:** https://github.com/protomaps/basemaps-assets/releases — grab
`fonts.zip` from the latest release, unzip into `frontend/public/fonts/`.

The folder structure after unzipping should be:

```
frontend/public/fonts/
  Noto Sans Bold/
    0-255.pbf
    256-511.pbf
    ...
  Noto Sans Regular/
    0-255.pbf
    ...
```

Font directories are git-ignored (too large to commit).

---

## sprites/

Minimal placeholder sprite sheet is committed (`sprite.json`, `sprite.png`).
The style defines no icon symbols so no additional sprites are required.

If you add icon symbol layers, replace these with a real sprite sheet generated
by [spritezero](https://github.com/mapbox/spritezero) or
[spreet](https://github.com/flother/spreet).
