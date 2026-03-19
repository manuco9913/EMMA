# Research: Terrain / Topography Data Source

## Overview

This document evaluates global digital elevation model (DEM) data sources for
offline (air-gapped) use in the Wave Propagation Simulator. The system performs
up to 72 million terrain elevation queries per scenario (10 entities × 3,600
rays × 2,000 distance steps at 100 m intervals out to 200 km radius). Terrain
queries must be answered from locally cached GeoTIFF tiles — no network access
at query time.

Key constraints:
- **Offline / air-gapped**: tiles must be pre-downloaded; no runtime network dependency
- **Resolution**: 30 m is sufficient (output grid is 100 m cells)
- **Coverage**: global (scenarios can be anywhere)
- **Format**: GeoTIFF preferred for rasterio compatibility
- **License**: must permit operational use without per-query fees

---

## SRTM (NASA)

### Overview

The Shuttle Radar Topography Mission (SRTM) flew aboard Space Shuttle Endeavour
in February 2000, producing the first near-global, consistent, high-resolution
digital topographic map of Earth using C-band SAR interferometry.

### Resolution and Coverage

| Parameter | Value |
|---|---|
| Native resolution (SRTM 1-Arc-Second) | ~30 m at the equator |
| Native resolution (SRTM 3-Arc-Second) | ~90 m (legacy, still available) |
| Latitude coverage | 56°S to 60°N |
| Void areas | ~0.4% of land surface; mostly steep terrain, water, dense vegetation |

Note: SRTM does not cover polar regions (above 60°N or below 56°S). For
scenarios in Norway, Alaska, Canada, or Antarctica, a supplementary source
is needed.

### Format and Tile Structure

- **Format**: GeoTIFF (`.tif`)
- **Projection**: Geographic (WGS84 / EPSG:4326)
- **Tile grid**: 1° × 1° tiles. Filename encodes SW corner: `N{lat}W{lon}.tif`
- **Tile dimensions**: 3601 × 3601 pixels (1° × 1°, with one overlapping pixel per edge)
- **Pixel value**: Integer (Int16), elevation in meters above EGM96 geoid
- **Void/no-data value**: -32768 (must be masked during sampling)

### File Size Per Tile

| Product | Compressed | Uncompressed |
|---|---|---|
| SRTM 1-Arc-Second (30 m) | ~25–30 MB | ~25 MB (Int16 × 3601² ≈ 25.9 MB) |
| SRTM 3-Arc-Second (90 m) | ~3–4 MB | ~3 MB |

### Total Global Size (1-Arc-Second)

- Full global dataset (56°S–60°N): ~18,000 tiles
- **Estimated total: ~430–450 GB** uncompressed; **~350–400 GB** LZW-compressed

### Accuracy

- **Absolute vertical accuracy**: ~16 m RMSE globally (90th percentile ≤ 9 m)
- **Relative vertical accuracy**: ~6 m RMSE
- Known issues: radar layover in steep terrain; canopy height contamination in
  forested areas (measures top of vegetation, not bare earth)

### License

- **Public domain** — produced by NASA/NGA (US government); no copyright
- Free for any use including commercial, military, and operational deployments
- Download via USGS EarthExplorer — free account required for bulk downloads
- Also via `elevation` Python CLI (wraps AWS S3 USGS mirror) and OpenTopography

### Void-Filled Variants

- **SRTMGL1 v3** (NASA LP DAAC): void-filled using ASTER GDEM and other sources
- **NASADEM**: reprocessed SRTM with improved void filling, released 2020 —
  generally preferred over original SRTM

---

## Copernicus DEM (GLO-30)

### Overview

The Copernicus DEM is produced by ESA and Airbus Defence & Space, derived from
the TanDEM-X satellite mission (2010–2015) using X-band InSAR. It is
significantly more accurate and more recent than SRTM. The GLO-30 product
(Global 30 m) is the publicly available variant.

### Resolution and Coverage

| Parameter | Value |
|---|---|
| Native resolution (GLO-30) | 1 arc-second (~30 m at equator) |
| Native resolution (GLO-90) | 3 arc-seconds (~90 m) — free alternative |
| Latitude coverage | **90°N to 90°S** (true global — unlike SRTM) |
| Water bodies | Flattened to consistent water level (hydrological conditioning) |
| Void filling | Near-void-free; very few data gaps |

### Format and Tile Structure

- **Format**: GeoTIFF (`.tif`), **Cloud Optimized GeoTIFF (COG)**
- **Projection**: Geographic (WGS84 / EPSG:4326)
- **Tile grid**: 1° × 1° tiles (same grid as SRTM — directly comparable)
- **Tile dimensions**: 3600 × 3600 pixels (no overlap row/column — differs from SRTM's 3601)
- **Pixel value**: Float32, elevation in meters above EGM2008 geoid
- **Filename**: `Copernicus_DSM_COG_10_N{lat:02d}_00_W{lon:03d}_00_DEM.tif`

Note: rasterio's `merge` handles the 3600 vs 3601 SRTM difference correctly.

### File Size Per Tile

| Product | Typical compressed size |
|---|---|
| GLO-30 (Float32, COG) | ~40–50 MB per 1°×1° tile |
| GLO-90 (Float32, COG) | ~5–8 MB per 1°×1° tile |

Float32 (4 bytes vs SRTM's Int16 2 bytes) and COG internal tiling account for
the larger size.

### Total Global Size (GLO-30)

- True global coverage: ~26,000 tiles (90°N–90°S)
- Land-only tiles: ~15,000–16,000
- **Estimated total (land): ~600–700 GB** compressed
- **Estimated total (full global): ~900 GB – 1.1 TB** compressed

### Accuracy

| Metric | Copernicus GLO-30 | SRTM 1-arc-second |
|---|---|---|
| Absolute vertical accuracy (LE90) | ~4 m globally | ~9–16 m |
| Relative vertical accuracy | ~2 m | ~6 m |
| Horizontal accuracy | ~6 m | ~20 m |
| Void fraction | <0.01% | ~0.4% |
| Temporal baseline | 2010–2015 | 2000 |

### License

- **Free for any use** including commercial, under the Copernicus Data Policy
- Requires **attribution**: "© DLR e.V. 2010-2014 and © Airbus Defence and
  Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA"
- **Download**: AWS S3 public bucket — no credentials required
  ```bash
  aws s3 sync s3://copernicus-dem-30m/ ./cop_dem_30/ --no-sign-request
  ```
- Also via OpenTopography and the ESA Copernicus Data Space portal

---

## ASTER GDEM

### Overview

ASTER Global DEM v3 (ASTGTM v003) is a joint NASA/METI product released 2019,
derived from optical stereo imagery. Resolution: 1 arc-second (~30 m), coverage
83°N–83°S.

### Accuracy and Known Issues

ASTER GDEM v3 is inferior to both SRTM and Copernicus DEM:
- **Vertical accuracy**: ~8.68 m RMSE (USGS validation, 2019)
- **Artifacts**: known spikes, pits, and cloud contamination from optical stereo
- **Water bodies**: poorly conditioned; lakes and rivers often show noise

ASTER GDEM is most useful as a void-filler for SRTM (which NASA has already
incorporated into SRTMGL1 v3). **Not recommended as a standalone primary source.**

---

## Comparison Table

| Attribute | SRTM 1-arc-sec (NASADEM) | Copernicus GLO-30 | ASTER GDEM v3 |
|---|---|---|---|
| Resolution | ~30 m | ~30 m | ~30 m |
| Polar coverage | No (56°S – 60°N) | Yes (90°S – 90°N) | Partial (83°S – 83°N) |
| Vertical accuracy (LE90) | 9–16 m | ~4 m | ~17 m |
| Void fraction | ~0.4% (filled in v3) | <0.01% | Sparse but artifacts |
| Pixel type | Int16 | Float32 | Int16 |
| Tile size (compressed) | ~25–30 MB | ~40–50 MB | ~25–30 MB |
| Global land size | ~350–400 GB | ~600–700 GB | ~350–400 GB |
| License | Public domain | Free, attribution required | Free |
| Public S3 bucket | Via OpenTopography / USGS | `s3://copernicus-dem-30m/` (no auth) | Via EarthData (login required) |
| Temporal baseline | 2000 (reprocessed 2020) | 2010–2015 | 2000–2013 |
| Quality for this project | Good | **Excellent** | Not recommended |

---

## Tile Download Strategy (Offline)

### Strategy Overview

Tiles must be downloaded before the system goes air-gapped and stored in a
local directory structure the backend reads directly. No runtime download;
rasterio reads from local disk only.

### AOI-Based Pre-Fetch Tile Calculation

```python
import math

def tiles_for_aoi(center_lat, center_lon, radius_km, tile_size_deg=1.0):
    lat_offset = radius_km / 111.0
    lon_offset = radius_km / (111.0 * math.cos(math.radians(center_lat)))

    lat_min = math.floor(center_lat - lat_offset)
    lat_max = math.floor(center_lat + lat_offset)
    lon_min = math.floor(center_lon - lon_offset)
    lon_max = math.floor(center_lon + lon_offset)

    return [(lat, lon)
            for lat in range(lat_min, lat_max + 1)
            for lon in range(lon_min, lon_max + 1)]
```

For a 200 km radius: lat_offset ≈ 1.8°. Typical result: **4×4 = 16 tiles**
(worst case ~25 tiles at high latitude).

### Tool Options for Pre-Fetching

#### Option A: AWS CLI — Copernicus GLO-30 (Recommended)

```bash
# Region loop (Western Europe: 40°N–60°N, 10°W–30°E)
for lat in $(seq 40 59); do
  for lon in $(seq -10 29); do
    NS=$([ $lat -ge 0 ] && echo "N" || echo "S")
    EW=$([ $lon -ge 0 ] && echo "E" || echo "W")
    PREFIX="Copernicus_DSM_COG_10_${NS}$(printf '%02d' ${lat#-})_00_${EW}$(printf '%03d' ${lon#-})_00_DEM"
    aws s3 sync "s3://copernicus-dem-30m/${PREFIX}/" \
      "./terrain-cache/${PREFIX}/" --no-sign-request
  done
done
```

#### Option B: `elevation` Python CLI — SRTM

```bash
pip install elevation
eio clip -o terrain.tif --bounds -2.0 50.0 2.0 53.0
```

Produces a single merged GeoTIFF — less suited to the tile-cache architecture.

#### Option C: GDAL VRT Mosaic

```bash
# Build a VRT over all pre-downloaded tiles
gdalbuildvrt -resolution highest -r bilinear \
  /terrain-cache/mosaic.vrt /terrain-cache/**/*.tif
```

### Recommended Directory Layout

```
terrain-cache/
├── copernicus-dem-30m/
│   ├── N51W001/
│   │   └── Copernicus_DSM_COG_10_N51_00_W001_00_DEM.tif
│   └── ...
├── mosaic.vrt              # rebuilt at container startup
└── tile-index.json         # tile coverage manifest
```

Docker-compose volume mount:

```yaml
services:
  backend:
    volumes:
      - ./terrain-cache:/terrain-cache:ro
    environment:
      - TERRAIN_CACHE_PATH=/terrain-cache/copernicus-dem-30m
      - TERRAIN_VRT_PATH=/terrain-cache/mosaic.vrt
```

Rebuild the VRT at container startup (< 1 second for thousands of tiles):

```bash
# entrypoint.sh
gdalbuildvrt "$TERRAIN_VRT_PATH" "$TERRAIN_CACHE_PATH"/**/*.tif
exec "$@"
```

---

## Storage Estimates

All estimates use Copernicus GLO-30 (~45 MB/tile average). SRTM tiles are
roughly half the size (~25 MB/tile).

| Deployment scope | Product | Estimated storage |
|---|---|---|
| Single country (e.g., UK) | Copernicus GLO-30 | 5–15 GB |
| Western Europe | Copernicus GLO-30 | ~80 GB |
| Continental US (CONUS) | Copernicus GLO-30 | ~40 GB |
| Full NATO coverage | Copernicus GLO-30 | ~150–200 GB |
| Global | Copernicus GLO-30 | ~700 GB – 1 TB |
| Global | SRTM NASADEM | ~375–425 GB |

A 2 TB NVMe SSD comfortably holds full NATO-region coverage alongside scenario
output storage.

---

## Integration with Rasterio

### Core Pattern: VRT Mosaic + Vectorized Sampling

```python
import rasterio
import numpy as np

def sample_terrain_batch(
    src: rasterio.DatasetReader,
    lats: np.ndarray,   # shape (N,)
    lons: np.ndarray,   # shape (N,)
) -> np.ndarray:
    """
    Sample terrain elevation at N (lat, lon) points using window read + array indexing.
    10–100× faster than rasterio.sample() for spatially coherent queries.
    """
    rows, cols = rasterio.transform.rowcol(src.transform, lons, lats)
    rows = np.asarray(rows)
    cols = np.asarray(cols)

    row_min, row_max = int(rows.min()), int(rows.max())
    col_min, col_max = int(cols.min()), int(cols.max())

    window = rasterio.windows.Window(
        col_off=col_min,
        row_off=row_min,
        width=col_max - col_min + 1,
        height=row_max - row_min + 1,
    )

    data = src.read(1, window=window)   # single disk read

    local_rows = np.clip(rows - row_min, 0, data.shape[0] - 1)
    local_cols = np.clip(cols - col_min, 0, data.shape[1] - 1)

    elevations = data[local_rows, local_cols].astype(np.float64)

    no_data = src.nodata if src.nodata is not None else -32768.0
    elevations[elevations == no_data] = 0.0
    elevations[np.isnan(elevations)] = 0.0

    return elevations

def preprocess_terrain(vrt_path: str, all_lats: np.ndarray, all_lons: np.ndarray) -> np.ndarray:
    with rasterio.open(vrt_path) as src:
        return sample_terrain_batch(src, all_lats, all_lons)
```

### Performance Characteristics

For the 72M point load (10 entities × 3,600 rays × 2,000 steps):
- Each entity's 7.2M points span a ~400 km × 400 km bounding box → ~13,000 × 13,000 pixels at 30 m
- Window read: ~13,000 × 13,000 × 4 bytes (Float32) = ~676 MB per entity (cached in OS page cache)
- NumPy array indexing of 7.2M points into an in-memory array: **< 1 second**
- **Realistic total preprocessing time: 30–120 seconds** depending on I/O speed and AOI overlap

### Handling Tile Boundaries

When a ray crosses a tile boundary, the VRT handles the stitch transparently.
No application-level boundary detection is needed — this is the primary reason
to use a VRT rather than opening tiles individually.

### Projection Notes

DEM tiles (both SRTM and Copernicus) are in **EPSG:4326 (WGS84 geographic)**.
The terrain query pipeline works in lat/lon and samples directly — no
reprojection needed for sampling.

---

## Handling Edge Cases

### Ocean / Water Areas

- Copernicus GLO-30: water bodies are hydrologically conditioned to a consistent surface level
- SRTM NASADEM: ocean pixels are set to 0
- **Handling**: treat NoData and values < −100 m as 0 (sea level). The
  `include_terrain` toggle already handles the fully-flat case.

### Missing Tiles

**Strategy**: fail fast at scenario preprocessing start with a clear error
rather than silently substituting zeros:

```python
def check_tile_coverage(required_tiles: list[str], cache_dir: Path) -> list[str]:
    return [t for t in required_tiles if not (cache_dir / t).exists()]

missing = check_tile_coverage(required_tiles, cache_dir)
if missing:
    raise RuntimeError(f"Missing terrain tiles for AOI: {missing}. "
                       f"Re-run tile pre-fetch before processing this scenario.")
```

### Geoid vs. Ellipsoid Heights

SRTM (EGM96) and Copernicus (EGM2008) elevations are referenced to a **geoid**
(orthometric height / AMSL), not the WGS84 ellipsoid. If antenna heights come
from GPS (HAE — Height Above Ellipsoid): apply geoid undulation correction
using `pyproj` or the `geoid` package.

### High-Latitude Longitude Compression

```python
lon_offset = radius_km / (111.0 * math.cos(math.radians(abs(center_lat))))
# At 70°N: 200 km → lon_offset ≈ 5.3° (vs ~2.5° at 45°N)
```

A 200 km radius scenario at 70°N may require ~11 tile columns instead of ~5.
The tile pre-fetch calculation must use the correct formula.

---

## Recommendation

**Use Copernicus DEM GLO-30 as the primary terrain data source.**

Rationale:

1. **Accuracy**: 2–4× better vertical accuracy than SRTM (~4 m vs ~9–16 m LE90).
   Terrain height errors directly translate to incorrect Fresnel zone calculations
   and shadowing predictions.

2. **True global coverage**: 90°S–90°N, including polar regions SRTM misses.
   Works anywhere without special-case logic for high-latitude deployments.

3. **Near-void-free**: Eliminates void-filling artifacts as a failure mode.

4. **Free bulk download**: The `s3://copernicus-dem-30m/` public S3 bucket
   allows scripted pre-download with no login, no per-tile fees.

5. **COG format**: Cloud-Optimized GeoTIFF with internal tiling is optimal for
   rasterio window reads from local disk.

6. **Architecture**: Pre-download tiles → mount as read-only Docker volume →
   rebuild VRT at container startup → sample via rasterio window reads + NumPy.

**Keep NASADEM as a documented fallback** for any rare Copernicus coverage gaps.

---

## Open Questions

1. **Polar edge tiles**: Confirm tile naming and manifest structure above ~80°
   latitude before assuming full polar coverage in production.

2. **Geoid correction for entity heights**: Clarify whether the MATLAB
   computation engine expects antenna heights as AMSL or HAE. If HAE
   (GPS-derived), implement EGM2008 geoid undulation lookup.

3. **VRT rebuild strategy**: Rebuild at every container startup (recommended —
   fast, ~100 ms for thousands of tiles) vs. only when the tile set changes.

4. **Tile index / manifest**: Maintain a `tile-index.json` listing each cached
   tile with its bounding box. Enables rapid pre-flight coverage checks.

5. **MATLAB elevation datum**: Confirm the MATLAB MCR model uses AMSL terrain
   heights (consistent with both SRTM and Copernicus). A silent datum mismatch
   produces incorrect terrain profiles that are difficult to debug.

6. **Canopy height vs. bare earth**: Both SRTM and Copernicus DEM measure the
   first-return radar surface (DSM), not bare earth (DTM). For RF/acoustic
   propagation, canopy is a real obstruction — DSM may be more physically correct.
   Confirm with the domain expert which surface the MATLAB model expects.

7. **Container image vs. external volume**: Never bundle terrain tiles in the
   Docker image. Always mount as an external volume. A Docker image containing
   a regional DEM would be hundreds of GB — impractical.
