import { useEffect, useState, useRef } from "react";
import { apiClient } from "../api/client";

// Header layout (56 bytes, little-endian), matches backend HEADER_FORMAT = "<IHHIIffdddd":
//  offset 0  — magic   uint32  (4 bytes)  0x57415645
//  offset 4  — version uint16  (2 bytes)
//  offset 6  — reserved uint16 (2 bytes)
//  offset 8  — width   uint32  (4 bytes)
//  offset 12 — height  uint32  (4 bytes)
//  offset 16 — min_val float32 (4 bytes)
//  offset 20 — max_val float32 (4 bytes)
//  offset 24 — west    float64 (8 bytes)
//  offset 32 — south   float64 (8 bytes)
//  offset 40 — east    float64 (8 bytes)
//  offset 48 — north   float64 (8 bytes)
//  Total: 56 bytes
const HEADER_SIZE = 56;
const MAGIC = 0x57415645;

export interface SliceData {
  width: number;
  height: number;
  minVal: number;
  maxVal: number;
  west: number;
  south: number;
  east: number;
  north: number;
  data: Float32Array;
}

export function useSliceFetcher(
  runId: string | null,
  heightM: number
): { slice: SliceData | null; loading: boolean; error: string | null } {
  const [slice, setSlice] = useState<SliceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!runId) {
      setSlice(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    apiClient
      .getSlice(runId, heightM)
      .then((buffer) => {
        const parsed = parseSlice(buffer);
        setSlice(parsed);
        setError(null);
      })
      .catch((err) => {
        if (err.name !== "CanceledError" && err.name !== "AbortError") {
          setError(String(err));
        }
      })
      .finally(() => setLoading(false));
  }, [runId, heightM]);

  return { slice, loading, error };
}

function parseSlice(buffer: ArrayBuffer): SliceData {
  if (buffer.byteLength < HEADER_SIZE) {
    throw new Error(`Buffer too small: ${buffer.byteLength} bytes`);
  }

  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(`Invalid magic: 0x${magic.toString(16)}`);
  }

  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const minVal = view.getFloat32(16, true);
  const maxVal = view.getFloat32(20, true);
  const west = view.getFloat64(24, true);
  const south = view.getFloat64(32, true);
  const east = view.getFloat64(40, true);
  const north = view.getFloat64(48, true);

  const data = new Float32Array(buffer, HEADER_SIZE);

  return { width, height, minVal, maxVal, west, south, east, north, data };
}
