#!/usr/bin/env bash
# Downloads a PMTiles region extract and self-hosted fonts into backend/static/.
# Requires: Docker (uses ghcr.io/protomaps/go-pmtiles — no host Go install needed)
# Usage:
#   bash scripts/setup-offline-tiles.sh              # London (~5 MB, default)
#   BBOX="-10.5,35.8,31.4,71.2" bash scripts/setup-offline-tiles.sh  # Western Europe
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TILES_DIR="${REPO_ROOT}/backend/static/tiles"
FONTS_DIR="${REPO_ROOT}/backend/static/fonts"

# Geographic scope — override via BBOX env var
BBOX="${BBOX:--0.5,51.3,0.2,51.6}"

# Protomaps daily planet build (uses HTTP range requests — full planet is NOT downloaded)
PLANET_URL="https://build.protomaps.com/planet.pmtiles"

# Protomaps basemap font assets
FONTS_URL="https://github.com/protomaps/basemaps-assets/releases/download/v5/fonts.tar.gz"

mkdir -p "${TILES_DIR}" "${FONTS_DIR}"

echo "==> Extracting PMTiles bbox=${BBOX}"
echo "    (uses range requests against ${PLANET_URL})"
docker run --rm \
  -v "${TILES_DIR}:/out" \
  ghcr.io/protomaps/go-pmtiles:latest \
  extract "${PLANET_URL}" /out/region.pmtiles --bbox="${BBOX}"

echo "==> Downloading fonts (~20 MB)"
curl -fsSL "${FONTS_URL}" | tar -xz -C "${FONTS_DIR}"

echo ""
echo "Done."
echo "  Tiles : ${TILES_DIR}/region.pmtiles"
echo "  Fonts : ${FONTS_DIR}/"
echo ""
echo "Start the stack and open the app to see the offline map:"
echo "  docker compose up --build"
