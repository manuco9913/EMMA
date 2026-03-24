import { useCallback } from "react";
import Map, { Marker, Source, Layer } from "react-map-gl/maplibre";
import type { MapMouseEvent } from "react-map-gl/maplibre";
import { useSimStore } from "../store";
import HeatmapLayer from "../heatmap/HeatmapLayer";
import { useSliceFetcher } from "../heatmap/useSliceFetcher";
import { circleGeoJSON, entityColor } from "./circleHelpers";

// OSM raster style for the prototype (no PMTiles needed)
const MAP_STYLE = {
  version: 8 as const,
  sources: {
    "osm-tiles": {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm-layer",
      type: "raster" as const,
      source: "osm-tiles",
      paint: { "raster-opacity": 0.85 },
    },
  ],
};

export default function MapView() {
  const {
    draftEntities,
    placingEntityIndex,
    updateEntity,
    setPlacingEntityIndex,
    activeRun,
    currentHeightM,
  } = useSimStore();

  const { slice } = useSliceFetcher(activeRun?.id ?? null, currentHeightM);

  const handleMapClick = useCallback(
    (evt: MapMouseEvent) => {
      if (placingEntityIndex === null) return;
      const { lng, lat } = evt.lngLat;
      const entity = draftEntities[placingEntityIndex];
      if (entity) {
        updateEntity(entity._id, { lon: lng, lat });
        setPlacingEntityIndex(null);
      }
    },
    [placingEntityIndex, draftEntities, updateEntity, setPlacingEntityIndex]
  );

  const placedEntities = draftEntities.filter((e) => e.lat !== 0 || e.lon !== 0);

  return (
    <Map
      initialViewState={{ longitude: 0, latitude: 51.5, zoom: 6 }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={MAP_STYLE}
      onClick={handleMapClick}
      cursor={placingEntityIndex !== null ? "crosshair" : "grab"}
    >
      {/* Radius circles as GeoJSON fill + stroke */}
      {placedEntities.map((entity, idx) => {
        const geojson = circleGeoJSON(entity.lat, entity.lon, entity.radius_km);
        const color = entityColor(idx);
        const sourceId = `circle-${entity._id}`;
        return (
          <Source key={sourceId} id={sourceId} type="geojson" data={geojson}>
            <Layer
              id={`${sourceId}-fill`}
              type="fill"
              source={sourceId}
              paint={{ "fill-color": color, "fill-opacity": 0.08 }}
            />
            <Layer
              id={`${sourceId}-stroke`}
              type="line"
              source={sourceId}
              paint={{ "line-color": color, "line-width": 1.5, "line-dasharray": [4, 2] }}
            />
          </Source>
        );
      })}

      {/* Entity markers */}
      {placedEntities.map((entity, idx) => (
        <Marker
          key={entity._id}
          longitude={entity.lon}
          latitude={entity.lat}
          anchor="center"
        >
          <EntityMarker index={idx} />
        </Marker>
      ))}

      {/* Heatmap overlay */}
      <HeatmapLayer slice={slice} opacity={0.65} />

      {/* Placement crosshair hint */}
      {placingEntityIndex !== null && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            padding: "6px 14px",
            borderRadius: 6,
            fontSize: 13,
            pointerEvents: "none",
            zIndex: 9,
          }}
        >
          Click map to place Entity {placingEntityIndex + 1}
        </div>
      )}
    </Map>
  );
}

const ENTITY_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

function EntityMarker({ index }: { index: number }) {
  const color = ENTITY_COLORS[index % ENTITY_COLORS.length];
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        background: color,
        border: "2px solid white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontSize: 11,
        fontWeight: 700,
        boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
        cursor: "default",
        userSelect: "none",
      }}
    >
      {index + 1}
    </div>
  );
}
