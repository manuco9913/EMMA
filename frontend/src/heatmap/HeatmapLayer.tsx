/**
 * HeatmapLayer — renders a propagation slice as a colored image overlay on MapLibre.
 *
 * Phase 1 approach: convert Float32Array → RGBA canvas → MapLibre image source.
 * The Phase 2 upgrade path is a custom Deck.gl R32F texture + GLSL shader.
 */
import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { ImageSource } from "maplibre-gl";
import type { SliceData } from "./useSliceFetcher";

const SOURCE_ID = "heatmap-source";
const LAYER_ID = "heatmap-layer";

interface Props {
  slice: SliceData | null;
  opacity?: number;
  colorBreakpoints?: ColorBreakpoint[];
}

export interface ColorBreakpoint {
  value: number; // absolute dBm value
  color: [number, number, number]; // RGB 0-255
}

// Default viridis-style color ramp (purple → blue → teal → green → yellow)
const DEFAULT_BREAKPOINTS: ColorBreakpoint[] = [
  { value: -120, color: [68, 1, 84] },
  { value: -100, color: [58, 82, 139] },
  { value: -80, color: [32, 144, 140] },
  { value: -60, color: [94, 201, 97] },
  { value: -40, color: [253, 231, 37] },
];

function interpolateColor(
  value: number,
  breakpoints: ColorBreakpoint[]
): [number, number, number, number] {
  if (breakpoints.length === 0) return [0, 0, 0, 0];

  if (value <= breakpoints[0].value) {
    const [r, g, b] = breakpoints[0].color;
    return [r, g, b, 200];
  }
  if (value >= breakpoints[breakpoints.length - 1].value) {
    const [r, g, b] = breakpoints[breakpoints.length - 1].color;
    return [r, g, b, 200];
  }

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const lo = breakpoints[i];
    const hi = breakpoints[i + 1];
    if (value >= lo.value && value <= hi.value) {
      const t = (value - lo.value) / (hi.value - lo.value);
      return [
        Math.round(lo.color[0] + t * (hi.color[0] - lo.color[0])),
        Math.round(lo.color[1] + t * (hi.color[1] - lo.color[1])),
        Math.round(lo.color[2] + t * (hi.color[2] - lo.color[2])),
        200,
      ];
    }
  }
  return [0, 0, 0, 0];
}

function sliceToImageData(
  slice: SliceData,
  breakpoints: ColorBreakpoint[]
): ImageData {
  const { width, height, data } = slice;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const v = data[i];
    if (!isFinite(v) || v <= -199) {
      // transparent
      rgba[i * 4 + 3] = 0;
      continue;
    }
    const [r, g, b, a] = interpolateColor(v, breakpoints);
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }

  return new ImageData(rgba, width, height);
}

export default function HeatmapLayer({
  slice,
  opacity = 0.7,
  colorBreakpoints = DEFAULT_BREAKPOINTS,
}: Props) {
  const { current: map } = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!map) return;
    const mapInstance = map.getMap();

    // Cleanup helper
    const cleanup = () => {
      if (mapInstance.getLayer(LAYER_ID)) mapInstance.removeLayer(LAYER_ID);
      if (mapInstance.getSource(SOURCE_ID)) mapInstance.removeSource(SOURCE_ID);
    };

    if (!slice) {
      cleanup();
      return;
    }

    // Render slice to offscreen canvas
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    canvas.width = slice.width;
    canvas.height = slice.height;
    const ctx = canvas.getContext("2d")!;
    const imageData = sliceToImageData(slice, colorBreakpoints);
    ctx.putImageData(imageData, 0, 0);

    const imageUrl = canvas.toDataURL("image/png");
    const coords: [[number, number], [number, number], [number, number], [number, number]] = [
      [slice.west, slice.north],  // top-left
      [slice.east, slice.north],  // top-right
      [slice.east, slice.south],  // bottom-right
      [slice.west, slice.south],  // bottom-left
    ];

    const updateSource = () => {
      if (mapInstance.getSource(SOURCE_ID)) {
        // Update existing source
        (mapInstance.getSource(SOURCE_ID) as ImageSource).updateImage({
          url: imageUrl,
          coordinates: coords,
        });
        if (mapInstance.getLayer(LAYER_ID)) {
          mapInstance.setPaintProperty(LAYER_ID, "raster-opacity", opacity);
        }
      } else {
        // Add new source + layer
        mapInstance.addSource(SOURCE_ID, {
          type: "image",
          url: imageUrl,
          coordinates: coords,
        });
        mapInstance.addLayer({
          id: LAYER_ID,
          type: "raster",
          source: SOURCE_ID,
          paint: {
            "raster-opacity": opacity,
            "raster-fade-duration": 0,
          },
        });
      }
    };

    if (mapInstance.isStyleLoaded()) {
      updateSource();
    } else {
      mapInstance.once("load", updateSource);
    }

    return () => {
      // Don't remove on cleanup — parent unmount handles it
    };
  }, [slice, opacity, colorBreakpoints, map]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!map) return;
      const mapInstance = map.getMap();
      if (mapInstance.getLayer(LAYER_ID)) mapInstance.removeLayer(LAYER_ID);
      if (mapInstance.getSource(SOURCE_ID)) mapInstance.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}
