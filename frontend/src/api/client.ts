import axios from "axios";

const api = axios.create({ baseURL: "/api" });

export interface EntityInput {
  lat: number;
  lon: number;
  radius_km: number;
  frequency_hz: number;
  power_w: number;
  azimuth_deg: number;
  antenna_height_m: number;
}

export interface ScenarioCreateRequest {
  name: string;
  entities: EntityInput[];
  height_min_m: number;
  height_max_m: number;
  height_step_m: number;
  angular_resolution_deg: number;
  grid_cell_size_m: number;
  include_terrain: boolean;
  combination_method: "max" | "sum";
}

export interface ScenarioCreateResponse {
  scenario_id: string;
  job_id: string;
}

export interface RunOut {
  id: string;
  job_id: string;
  height_min_m: number;
  height_max_m: number;
  height_step_m: number;
  bbox_west: number | null;
  bbox_south: number | null;
  bbox_east: number | null;
  bbox_north: number | null;
  is_saved: boolean;
  name: string | null;
  created_at: string;
}

export interface EntityOut {
  id: string;
  lat: number;
  lon: number;
  radius_km: number;
  frequency_hz: number;
  power_w: number;
  azimuth_deg: number;
  antenna_height_m: number;
}

export interface ScenarioOut {
  id: string;
  name: string;
  params: Record<string, unknown>;
  created_at: string;
  entities: EntityOut[];
  runs: RunOut[];
}

export const apiClient = {
  createScenario: (body: ScenarioCreateRequest) =>
    api.post<ScenarioCreateResponse>("/scenarios", body).then((r) => r.data),

  getScenario: (id: string) =>
    api.get<ScenarioOut>(`/scenarios/${id}`).then((r) => r.data),

  listScenarios: () =>
    api.get<ScenarioOut[]>("/scenarios").then((r) => r.data),

  getSlice: (runId: string, heightM: number) =>
    api.get<ArrayBuffer>(`/runs/${runId}/slice`, {
      params: { height_m: heightM },
      responseType: "arraybuffer",
    }).then((r) => r.data),
};
