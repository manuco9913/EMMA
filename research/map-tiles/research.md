# Research: Map Tile Provider (Offline-Capable)

**Date:** 2026-03-19
**Context:** Wave Propagation Simulator — React/Svelte frontend, MapLibre GL JS, Deck.gl heatmap overlay, air-gapped deployment requirement.

---

## Overview

The Wave Propagation Simulator requires a map base layer for entity placement and heatmap visualization. The application must operate in air-gapped environments with no internet access, which eliminates all cloud-hosted tile services (Mapbox, Google Maps, Esri, HERE, etc.) that require live API calls or token validation.

The solution space narrows to:

1. **Pre-bundled tile data** shipped with the application or hosted on a local server within the deployment environment.
2. A **map rendering library** that can consume those tiles without phoning home.

MapLibre GL JS satisfies the rendering requirement — it is a fully open-source, WebGL-based fork of Mapbox GL JS v1 that has no telemetry, no API key requirement, and no external network calls. The remaining question is how to package and serve tile data offline.

This document evaluates tile formats, self-hosted tile servers, the PMTiles single-file approach, tooling for tile extraction, MapLibre integration patterns, storage budgets, and a final recommendation.

---

## Tile Formats (MBTiles vs PMTiles vs XYZ vs Vector)

### Raster XYZ (Slippy Map Tiles)

Raster XYZ is the classic tile scheme: a directory tree of PNG or JPEG images organized as `/{z}/{x}/{y}.png`. Each image is a pre-rendered map view at a fixed zoom level and geographic extent.

**Advantages:**
- Universally understood by every map library.
- Simple to serve — any static file server works.
- No client-side rendering complexity.

**Disadvantages:**
- Extremely large storage footprint. Raster tiles at zoom 0–14 for the full planet exceed 300–400 GB even with aggressive JPEG compression.
- Tiles are pre-styled. Changing colors, labels, or layer visibility requires regenerating the entire tile set.
- Poor scalability for high zoom levels — zoom 15 alone rivals the cumulative size of all lower zooms.
- Not suitable for the millions-of-files directory structure in containerized deployments.

**Offline viability:** Workable for regional extracts at low zoom levels only. Not recommended for this project due to storage costs and styling inflexibility.

### MBTiles

MBTiles is a specification (originally from Mapbox) for storing map tiles in a single SQLite database file. Tiles are stored in a `tiles` table keyed by `(zoom_level, tile_column, tile_row)`. The format supports both raster (PNG/JPEG) and vector (PBF/MVT) tile content.

**Advantages:**
- Single-file packaging — easy to copy, version, and distribute.
- Well-supported ecosystem: tileserver-gl, mbtileserver, mbutil, QGIS, and many others.
- Transactional SQLite gives integrity guarantees.
- Deduplication via the `map`/`images` table split — identical tiles (e.g., ocean tiles) are stored once.

**Disadvantages:**
- Requires a tile server process to expose tiles over HTTP. The browser cannot read SQLite directly.
- Random-access reads in SQLite are efficient, but the file must reside on a filesystem accessible to the server process.
- Not natively streamable over HTTP range requests — a server process is mandatory.
- Large files (>10 GB) can be cumbersome for SQLite on some filesystems.

**Offline viability:** Excellent when paired with a tile server (tileserver-gl, mbtileserver). The additional operational complexity of running a sidecar tile server process is the primary drawback.

### PMTiles

PMTiles is a modern single-file archive format designed specifically for HTTP range-request access. Tiles are stored in a flat binary file with a hierarchical directory structure at the header that allows a client to locate any tile using only 2–3 HTTP range requests.

**Advantages:**
- No tile server required. The file can be served from any HTTP server that supports range requests (nginx, FastAPI/Starlette static files, S3, Cloudflare R2, etc.).
- Native MapLibre GL JS support via the `pmtiles` JavaScript library — adds a custom protocol handler (`pmtiles://`) that intercepts tile requests and issues range reads against a local or remote URL.
- Supports both raster and vector (MVT/PBF) content.
- Deduplication of identical tiles built into the format.
- Single file simplifies deployment — copy one file, point the config at it.
- Actively maintained by Protomaps; the format is open and well-documented.

**Disadvantages:**
- The `pmtiles` JS library adds a small bundle overhead (~50 KB gzipped).
- HTTP range request support must be enabled on the server (standard, but worth verifying in restricted environments).
- Slightly higher per-tile read latency than a warm SQLite cache, though negligible in practice for local-network serving.

**Offline viability:** Best option for offline deployments. Zero additional server infrastructure required if the backend already serves static files.

### Vector Tiles (MVT / PBF)

Vector tiles encode geographic features (points, lines, polygons) as binary Protocol Buffer (PBF) data following the Mapbox Vector Tile (MVT) specification. The client-side renderer (MapLibre GL JS) decodes features and renders them using WebGL according to a style JSON document.

**Advantages:**
- Small file sizes relative to equivalent raster coverage. A full-planet vector tile set at zoom 0–14 is ~70–100 GB; comparable raster coverage exceeds 300 GB.
- Client-side styling: colors, fonts, label visibility, and layer ordering are controlled by the style JSON without regenerating tiles. Critical for a simulator that may need multiple visual modes.
- High-DPI rendering at no extra cost — vectors scale perfectly.
- Deck.gl heatmap overlays integrate cleanly on top of vector base maps.
- Supports zoom levels above 14 via "overzoom" — the client re-renders zoom 14 tiles at higher zoom without additional tile data.

**Disadvantages:**
- Requires a WebGL-capable renderer (MapLibre GL JS satisfies this).
- Fonts (glyphs) and sprites must also be self-hosted for fully offline operation.
- Style JSON must reference local URLs for all assets.

**Offline viability:** Excellent. All major offline tile stacks (MBTiles, PMTiles) support vector tile content. This is the recommended tile type for this project.

---

## Self-Hosted Tile Servers

Self-hosted tile servers sit between tile data (MBTiles or PMTiles files) and the browser, exposing a standard XYZ HTTP endpoint. They are necessary when using MBTiles but optional when using PMTiles.

### tileserver-gl

**Language:** Node.js
**Repository:** `maptiler/tileserver-gl`
**Docker:** Official image at `maptiler/tileserver-gl`

tileserver-gl is the most feature-complete open-source tile server. It serves vector tiles from MBTiles sources, renders raster tiles server-side using MapLibre GL Native (a C++ port of MapLibre), and provides a built-in style viewer.

**Key features:**
- Serves MVT vector tiles directly from MBTiles.
- Can render raster tiles on-the-fly from vector data + a style JSON, enabling raster fallback for clients that do not support WebGL.
- Serves fonts (glyphs) and sprites from local directories.
- Config-driven via a JSON config file listing sources and styles.
- Docker image is straightforward: mount an MBTiles file and a config file, expose port 8080.

**Example Docker invocation:**
```
docker run -v /data:/data -p 8080:8080 maptiler/tileserver-gl --config /data/config.json
```

**Limitations:**
- Node.js process with native addons (MapLibre GL Native) — image is large (~500 MB) and startup is slower than lighter alternatives.
- Raster rendering is CPU-intensive at high concurrency.
- Overkill if only vector tile serving (no raster rendering) is needed.

**Verdict:** Best choice when raster tile rendering or the built-in style viewer is required. Otherwise, heavier than necessary.

### Martin (Rust)

**Language:** Rust
**Repository:** `maplibre/martin`
**Docker:** `ghcr.io/maplibre/martin`

Martin is a high-performance tile server written in Rust. It serves vector tiles from MBTiles, PMTiles, and PostGIS (if a database connection is available). It is significantly faster and more resource-efficient than tileserver-gl for pure vector tile serving.

**Key features:**
- Serves MVT from MBTiles and PMTiles sources without raster rendering.
- PostGIS source support — can generate tiles dynamically from a spatial database (not needed for offline use, but useful in hybrid deployments).
- Auto-discovery of MBTiles/PMTiles files in a configured directory.
- YAML-based configuration.
- Very low memory footprint; handles high concurrency efficiently.
- Docker image is small (~50 MB).

**Example Docker invocation:**
```
docker run -v /data:/data -p 3000:3000 ghcr.io/maplibre/martin /data/planet.mbtiles
```

**Limitations:**
- No built-in raster rendering — vector only.
- No built-in style server (fonts/sprites must be served separately or from another path).
- Younger project than tileserver-gl; some edge cases less battle-tested.

**Verdict:** Best choice for lightweight vector tile serving from MBTiles or PMTiles. Recommended when the backend already handles fonts and sprites.

### mbtileserver

**Language:** Go
**Repository:** `consbio/mbtileserver`
**Docker:** `ghcr.io/consbio/mbtileserver`

mbtileserver is a minimal, single-binary Go server for MBTiles files. It auto-discovers all MBTiles files in a configured directory and exposes each as a TileJSON endpoint plus XYZ tile endpoint.

**Key features:**
- Single static binary — no runtime dependencies, easy to embed in Docker or ship as a sidecar.
- Automatic MBTiles discovery from a root directory.
- TileJSON metadata endpoint per tileset.
- CORS support.
- Extremely low resource usage.

**Limitations:**
- MBTiles only (no PMTiles source support).
- No raster rendering.
- No font/sprite serving.
- Minimal configuration options.

**Verdict:** Best choice for simplest possible MBTiles serving with minimal operational overhead. Good for embedded or resource-constrained deployments.

### Comparison Summary

| Server | Language | Vector Tiles | Raster Render | PMTiles Source | Docker Size | Complexity |
|---|---|---|---|---|---|---|
| tileserver-gl | Node.js | Yes | Yes | No | ~500 MB | High |
| Martin | Rust | Yes | No | Yes | ~50 MB | Low |
| mbtileserver | Go | Yes | No | No | ~20 MB | Minimal |

---

## PMTiles (Single-File Approach)

### Format Internals

A PMTiles file consists of:

1. **Fixed 127-byte header** — magic bytes, version, metadata length, root directory offset, tile data offset, and compression flags.
2. **JSON metadata** — tileset name, attribution, zoom range, bounding box, format (pbf/png/jpg/webp).
3. **Root directory** — a compact binary structure mapping tile IDs (Hilbert curve-ordered) to byte ranges within the file.
4. **Leaf directories** — overflow directories for large tilesets (typically needed beyond ~21,000 tiles).
5. **Tile data** — raw compressed tile bytes, deduplicated (identical tiles share one copy).

Tile lookup requires at most 2–3 range requests: one to fetch a leaf directory entry, one to fetch the tile data. For warm HTTP connections (keep-alive), this is fast enough for interactive map use.

### HTTP Range Request Serving

Any HTTP/1.1-compliant server supports range requests via the `Range` header. The pmtiles JS library issues `GET` requests with `Range: bytes=N-M` headers against the PMTiles file URL.

**Compatible servers for local/offline deployment:**
- **nginx** — `sendfile` + range requests work out of the box. No configuration needed beyond a static file location block.
- **FastAPI / Starlette** (`StaticFiles` middleware) — Python's `http.server` and Starlette both support range requests natively.
- **Caddy** — range requests supported by default.
- **Apache httpd** — range requests supported by default.
- **Python `http.server`** — supports range requests as of Python 3.x.

This means that if the Wave Propagation Simulator backend already serves static files (e.g., via FastAPI's `StaticFiles`), the PMTiles file can be placed in the static directory and served with zero additional infrastructure.

### MapLibre GL JS Integration

The `pmtiles` npm package (published by Protomaps) provides a protocol handler that integrates with MapLibre GL JS:

```javascript
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));
```

After registration, tile sources in the MapLibre style JSON can reference PMTiles files using the `pmtiles://` URL scheme:

```json
{
  "sources": {
    "openmaptiles": {
      "type": "vector",
      "url": "pmtiles:///static/planet.pmtiles"
    }
  }
}
```

The library intercepts all `pmtiles://` requests, translates them into HTTP range requests against the resolved file URL, parses the response, and returns tile data to MapLibre — all transparently.

### Offline Viability Assessment

PMTiles is purpose-built for offline and edge deployments:

- No server process required beyond what already serves the web app.
- Single file to copy, version, and back up.
- Works identically whether the file is on a local filesystem (served via nginx) or on an internal S3-compatible object store (MinIO, Ceph).
- The pmtiles CLI tool can be used offline to inspect, validate, and extract individual tiles from the archive.
- No license server, API key, or network validation of any kind.

---

## Tile Extraction / Download Tools

To populate an offline deployment, tile data must be extracted from OpenStreetMap (or other sources) and packaged into MBTiles or PMTiles format. The following tools are the primary options.

### Planetiler

**Language:** Java
**Repository:** `onthegomap/planetiler`
**Output:** PMTiles or MBTiles (vector, MVT/PBF)

Planetiler is the state-of-the-art tool for generating OpenStreetMap vector tile sets from raw OSM data (`.osm.pbf` format). It processes the full planet OSM dump in under 2 hours on modest hardware (~32 GB RAM, NVMe SSD) — an order of magnitude faster than older tools like Openmaptiles-tools.

**How it works:**
1. Download an OSM PBF file (full planet from planet.osm.org, or regional extract from Geofabrik).
2. Run Planetiler with a profile (schema) that defines which OSM features to include and how to map them to vector tile layers.
3. Planetiler reads OSM data in passes, sorts features by tile ID, and writes the output PMTiles or MBTiles file.

**Key features:**
- Produces tiles compatible with the OpenMapTiles schema — the most widely supported vector tile schema, with ready-made MapLibre GL JS styles.
- Direct PMTiles output — no conversion step needed.
- Regional extract support — can process a country or region PBF directly.
- Configurable zoom range (zoom 0–14 is standard; zoom 15 adds significant size).
- Runs entirely offline after the OSM PBF is downloaded.

**Typical invocation for a regional extract:**
```
java -Xmx16g -jar planetiler.jar \
  --download --area=western-europe \
  --output=western-europe.pmtiles \
  --maxzoom=14
```

**Verdict:** Primary recommended tool for generating tile data for this project.

### Protomaps Download Service

Protomaps (the creator of PMTiles) operates a public tile download service at `maps.protomaps.com/builds/` that provides pre-generated PMTiles files for the full planet and regional extracts, updated regularly from OpenStreetMap data.

**Key features:**
- Pre-built planet and regional PMTiles files — no local processing required.
- Uses the Protomaps vector tile schema (similar to but not identical to OpenMapTiles).
- Files are available via HTTP for direct download.
- Regional extracts can be cut from the planet file using the `pmtiles extract` CLI command.

**Workflow for offline deployment:**
1. Download the desired PMTiles file (planet or region) during an online preparation phase.
2. Transfer the file to the air-gapped environment.
3. Serve from the backend's static file directory.

**Protomaps CLI extract example:**
```
pmtiles extract https://maps.protomaps.com/builds/planet_YYYYMMDD.pmtiles \
  output-region.pmtiles \
  --bbox="-10.5,35.8,31.4,71.2"
```

This cuts a bounding box extract from the remote planet file using range requests — the full planet file is not downloaded, only the tiles within the bounding box.

**Verdict:** Fastest path to a ready-to-use tile file if an internet connection is available during a preparation phase. Pairs with the pmtiles CLI for offline region extraction.

### tilelive

**Language:** Node.js
**Repository:** `mapbox/tilelive` (ecosystem of source/sink modules)

tilelive is a Node.js streaming tile processing framework. It is not a single tool but an ecosystem: `tilelive-file`, `tilelive-mbtiles`, `tilelive-http`, and many other modules expose tile sources and sinks through a common interface. The `tl` CLI wrapper orchestrates copies between sources and sinks.

**Use cases:**
- Converting between MBTiles and XYZ directory trees.
- Merging multiple MBTiles files.
- Filtering or reprocessing tile sets.

**Limitations:**
- Ecosystem is fragmented and many modules are unmaintained.
- Slow for large tile sets — not suitable for full-planet processing.
- No PMTiles support.

**Verdict:** Useful for MBTiles manipulation and format conversion in specific cases, but not a primary tool for this project.

### mbutil

**Language:** Python
**Repository:** `mapbox/mbutil`

mbutil is a simple Python script that imports and exports MBTiles files to/from XYZ directory trees.

**Use cases:**
- Extracting an MBTiles file to a static directory tree for direct static file serving.
- Inspecting MBTiles contents.
- Merging small tile sets.

**Limitations:**
- MBTiles and XYZ only — no vector tile awareness, no PMTiles support.
- Slow for large files.
- Unmaintained (last significant activity 2020).

**Verdict:** Useful as a debugging and inspection tool. Not a primary workflow tool.

### pmtiles CLI

**Language:** Go
**Repository:** `protomaps/go-pmtiles`

The `pmtiles` CLI is the primary tool for working with PMTiles files offline:

- `pmtiles show <file>` — inspect metadata, zoom range, tile count, bounding box.
- `pmtiles extract <source> <dest> --bbox=...` — cut a geographic subset.
- `pmtiles verify <file>` — validate file integrity.
- `pmtiles convert <input.mbtiles> <output.pmtiles>` — convert MBTiles to PMTiles.
- `pmtiles serve <file>` — minimal HTTP tile server for development.

**Verdict:** Essential companion tool for any PMTiles-based workflow.

---

## MapLibre GL JS Integration

### Offline Tile Support

MapLibre GL JS renders map tiles entirely client-side using WebGL. It has no hardcoded external URLs and makes no telemetry calls. All data URLs are specified in the style JSON document, which the application controls entirely.

For offline deployments, every external URL in the style JSON must be replaced with a locally hosted equivalent:
- **Tile source URL** — points to the local PMTiles file or local tile server.
- **Glyph (font) URL** — font PBF files for map labels. Must be self-hosted.
- **Sprite URL** — icon sprite sheet (PNG + JSON). Must be self-hosted.

### Local Tile URL Schemes

**PMTiles protocol (recommended):**
```json
{
  "sources": {
    "openmaptiles": {
      "type": "vector",
      "url": "pmtiles:///static/tiles/region.pmtiles"
    }
  }
}
```
Requires registering the pmtiles protocol handler before initializing the map.

**Local XYZ tile server:**
```json
{
  "sources": {
    "openmaptiles": {
      "type": "vector",
      "tiles": ["http://localhost:3000/tiles/{z}/{x}/{y}.pbf"],
      "minzoom": 0,
      "maxzoom": 14
    }
  }
}
```
Used when a tile server (Martin, mbtileserver) is running as a sidecar.

**Local MBTiles via tile server:**
Same as XYZ above — the tile server abstracts the MBTiles file as an XYZ endpoint.

### Style JSON for Self-Hosted Assets

A complete self-hosted style JSON must reference local URLs for all assets. Example structure:

```json
{
  "version": 8,
  "name": "Local Vector Map",
  "glyphs": "/static/fonts/{fontstack}/{range}.pbf",
  "sprite": "/static/sprites/osm-liberty",
  "sources": {
    "openmaptiles": {
      "type": "vector",
      "url": "pmtiles:///static/tiles/region.pmtiles"
    }
  },
  "layers": [ ... ]
}
```

Pre-built compatible style JSONs for the OpenMapTiles schema (which Planetiler produces) include:
- **OSM Liberty** — minimal, no proprietary fonts, fully self-hostable.
- **Positron** (Carto) — light gray style, open source.
- **Dark Matter** (Carto) — dark style, open source.
- **OpenMapTiles Basic** — reference style.

These styles require only that the `glyphs`, `sprite`, and `sources` URLs be updated to point to local assets. Font PBF files and sprites for these styles are available for download from the respective repositories.

### React Integration (react-map-gl)

`react-map-gl` v7+ supports MapLibre GL JS as its rendering backend. Install `maplibre-gl` and `react-map-gl`, and specify `mapLib` at the `Map` component level:

```jsx
import Map from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import maplibregl from 'maplibre-gl';

// Register protocol once at app initialization
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

function AppMap() {
  return (
    <Map
      initialViewState={{ longitude: 0, latitude: 40, zoom: 4 }}
      mapStyle="/static/style.json"
    />
  );
}
```

Deck.gl integrates via `react-map-gl`'s `DeckGLOverlay` component or via Deck.gl's `MapboxOverlay` (which is MapLibre-compatible).

### Svelte Integration (svelte-maplibre)

`svelte-maplibre` is the recommended MapLibre binding for Svelte. It wraps MapLibre GL JS with Svelte component conventions:

```svelte
<script>
  import { MapLibre } from 'svelte-maplibre';
  import { Protocol } from 'pmtiles';
  import maplibregl from 'maplibre-gl';

  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));
</script>

<MapLibre
  style="/static/style.json"
  center={[0, 40]}
  zoom={4}
/>
```

Deck.gl overlays are added using Deck.gl's `MapboxOverlay` widget, which is MapLibre-compatible via the interoperability layer.

### Glyph and Sprite Self-Hosting

Fonts for MapLibre GL JS are served as pre-rendered PBF glyph files in the pattern `/{fontstack}/{range}.pbf` (e.g., `/fonts/Open%20Sans%20Regular/0-255.pbf`). These must be downloaded and self-hosted. Sources:

- `openmaptiles/fonts` GitHub repository — contains pre-generated PBF files for common fonts (Open Sans, Noto Sans, Roboto).
- `protomaps/basemaps-assets` — font assets for the Protomaps style.

Sprites (icon sheets) consist of a PNG image and a JSON descriptor. These are static files and can be served from any static file location.

---

## Storage Estimates

Storage requirements vary significantly by geographic coverage and zoom level. The figures below are for vector tiles (MVT/PBF, compressed) in PMTiles format, which provides the most efficient packing.

### Full Planet

| Zoom Range | Approximate Size | Notes |
|---|---|---|
| 0–10 | ~1–2 GB | Global overview only, no street detail |
| 0–12 | ~15–20 GB | City-level detail |
| 0–14 | ~80–100 GB | Neighborhood detail, typical maximum |
| 0–15 | ~180–220 GB | Street-level detail |
| 0–16 | ~400–500 GB | Building-level detail |

Zoom 14 is the practical maximum for most applications — higher zoom levels grow the dataset size 2–4x per level while adding increasingly granular detail (individual building footprints, address points) that may not be useful for wave propagation simulation.

### Regional Extracts (Zoom 0–14)

| Region | Approximate Size |
|---|---|
| Western Europe (France, Germany, Spain, Italy, UK, Benelux, etc.) | 8–12 GB |
| CONUS (Continental United States) | 4–6 GB |
| Eastern Europe | 3–5 GB |
| Southeast Asia | 5–8 GB |
| Middle East | 2–4 GB |
| Country-level (e.g., Germany, France) | 0.5–2 GB |
| City-level bounding box (e.g., greater London) | 50–200 MB |

These estimates are based on OpenStreetMap data density as of 2025–2026. Data-dense regions (Western Europe, parts of the US) are at the higher end; sparsely mapped regions are at the lower end.

### Supplementary Assets

| Asset | Size |
|---|---|
| Font PBF files (full set, Open Sans + Noto) | ~50–100 MB |
| Sprite sheets (OSM Liberty or similar) | ~1–2 MB |
| Style JSON | < 1 MB |

### Deployment Sizing Guidance

For an air-gapped deployment where the operational theater is known in advance, a regional extract at zoom 0–14 is almost always sufficient. A CONUS extract at ~5 GB fits comfortably on any deployment medium. A Western Europe extract at ~10 GB is manageable on USB 3.0 drives or internal SSDs with fast transfer. The full planet at zoom 0–14 (~100 GB) is feasible on NVMe drives but may require dedicated storage planning in constrained environments.

---

## Why Mapbox Is Unsuitable

Mapbox GL JS v2+ (the closed-source fork) is unsuitable for this project for several independent reasons:

1. **Internet requirement for token validation.** Mapbox SDK initializes by validating the access token against `api.mapbox.com`. In an air-gapped environment with no internet access, this call fails and the map does not render.

2. **Telemetry and usage tracking.** Mapbox GL JS v2+ sends tile usage events to Mapbox servers for billing purposes. This is incompatible with air-gapped environments and potentially with security policies of the deployment environments.

3. **Proprietary license.** Mapbox GL JS v2+ uses a proprietary Business Source License (BUSL) that restricts use without a Mapbox account and commercial agreement. This creates legal and procurement risk for a government or defense application.

4. **Tile data dependency.** Mapbox tiles are served exclusively from Mapbox CDN infrastructure (`tiles.mapbox.com`). There is no provision for downloading and self-hosting Mapbox's tile data — the terms of service prohibit caching or redistribution of Mapbox tiles.

5. **API key management in classified environments.** Managing and rotating Mapbox API keys within air-gapped or classified networks introduces significant operational overhead and potential security surface.

**MapLibre GL JS** (the open-source fork at the v1 branch point) resolves all of these issues: BSD 3-Clause license, no telemetry, no token validation, no external network calls, no dependency on any third-party infrastructure.

---

## Recommendation

**Recommended stack: PMTiles + MapLibre GL JS, served from the backend's existing static file infrastructure.**

This combination minimizes operational complexity while satisfying all offline requirements:

### Why PMTiles Over MBTiles + Tile Server

- **No additional process.** If the backend (FastAPI, Express, Nginx, etc.) already serves the frontend's static assets, the PMTiles file is simply placed in the static directory. No tile server container to configure, monitor, or scale.
- **Single file.** One file to copy, version, and back up. Updating the map data is a file replacement operation.
- **Native MapLibre support.** The `pmtiles` npm package integrates in ~5 lines of JavaScript. No custom proxy or tile server URL needed.
- **Range request serving is universal.** Every production-grade HTTP server supports range requests out of the box.

### Recommended Workflow

**Preparation phase (online, once per deployment or map update):**

1. Download a regional OSM PBF extract from Geofabrik for the expected operational area.
2. Run Planetiler to generate a PMTiles file from the OSM PBF.
   - Alternatively, download a pre-built PMTiles extract from the Protomaps download service and cut to the operational bounding box using `pmtiles extract`.
3. Download font PBF files from `openmaptiles/fonts`.
4. Select and download a compatible style JSON (OSM Liberty or similar) and update all URLs to point to local paths.
5. Bundle or stage all assets (PMTiles file, fonts, sprites, style JSON) for deployment.

**Deployment (offline, air-gapped):**

1. Place the PMTiles file, fonts, sprites, and style JSON in the backend's static file directory.
2. Register the pmtiles protocol handler in the frontend JavaScript entry point.
3. Configure the MapLibre `Map` component with the local style JSON URL.
4. No additional services, ports, or containers required.

### Component Matrix

| Component | Choice | Rationale |
|---|---|---|
| Map renderer | MapLibre GL JS | Open source, no telemetry, no API key |
| Tile format | PMTiles (vector MVT) | Single file, no server required, native MapLibre support |
| Tile data source | Planetiler (from OSM PBF) or Protomaps download | Open data, reproducible, offline-capable after preparation |
| Tile serving | Backend static file middleware | Zero additional infrastructure |
| Font/sprite serving | Backend static file middleware | Same as above |
| React binding | react-map-gl v7+ (MapLibre backend) | Official, well-maintained |
| Svelte binding | svelte-maplibre | Native Svelte, active maintenance |
| Heatmap overlay | Deck.gl (MapboxOverlay / DeckGLOverlay) | Integrates with MapLibre via interop layer |

### Fallback: MBTiles + Martin

If HTTP range request support is blocked by network policy within the deployment environment (unusual but possible in some configurations), the fallback is:

- Package tile data as MBTiles (Planetiler supports this output format).
- Run Martin (Rust, ~50 MB Docker image) as a sidecar tile server.
- Update the style JSON `sources` to use Martin's XYZ endpoint (`http://localhost:3000/tiles/{z}/{x}/{y}.pbf`).

This fallback adds one container process but is otherwise operationally simple.

---

## Open Questions

1. **Geographic scope of deployment.** Which regions or countries constitute the expected operational area? This determines the tile extract size and download time during preparation. A tighter bounding box dramatically reduces the PMTiles file size.

2. **Maximum zoom level required.** Is street-level detail (zoom 15+) needed for entity placement, or is neighborhood/district-level (zoom 14) sufficient? Zoom 15 roughly doubles the dataset size over zoom 14.

3. **Tile schema preference.** Should tiles follow the OpenMapTiles schema (better style ecosystem, Planetiler native output) or the Protomaps schema (simpler schema, smaller tile size, fewer layers)? Both work with MapLibre GL JS but require different style JSONs.

4. **Backend technology.** What HTTP server or framework serves the frontend assets? This affects how the PMTiles file and supplementary assets (fonts, sprites) are served and whether any range request configuration is needed.

5. **Map update cadence.** How frequently does map data need to be refreshed? OSM data changes continuously; for most simulation use cases, annual or semi-annual tile regeneration is sufficient. A defined update process (re-run Planetiler, replace PMTiles file) should be documented.

6. **Satellite / raster imagery requirement.** This document covers OpenStreetMap-derived vector tiles. If the application requires satellite or aerial imagery as a base layer, the solution space changes significantly — raster satellite tile sets are orders of magnitude larger and typically require commercial licensing even for cached/offline use.

7. **Custom styling requirements.** Does the map need to match a specific color scheme, show/hide specific feature types (roads, buildings, terrain), or display classification-related visual modes? If so, a style JSON customization step should be planned as part of the frontend build.

8. **Terrain / elevation data.** If the wave propagation simulation benefits from terrain visualization (3D terrain, hillshading, contours), elevation data (e.g., from Copernicus DEM or SRTM) must be sourced and packaged separately from the vector base tiles. This is a significant additional data pipeline.
