import { create } from "zustand";
import type { EntityInput, RunOut, ScenarioOut } from "../api/client";

export interface DraftEntity extends EntityInput {
  _id: string; // client-side only, for list keys
}

interface JobState {
  jobId: string | null;
  progress: number | null;
  status: "idle" | "running" | "done" | "error";
  errorMessage: string | null;
}

interface SimState {
  // Scenario draft
  draftName: string;
  draftEntities: DraftEntity[];
  heightMinM: number;
  heightMaxM: number;
  heightStepM: number;
  angularResolutionDeg: number;
  gridCellSizeM: number;
  includeTerrain: boolean;
  combinationMethod: "max" | "sum";

  // Active result
  activeScenario: ScenarioOut | null;
  activeRun: RunOut | null;
  currentHeightM: number;

  // Job
  job: JobState;

  // Entity placement mode
  placingEntityIndex: number | null;

  // Actions
  setDraftName: (name: string) => void;
  addEntity: (entity: DraftEntity) => void;
  updateEntity: (id: string, patch: Partial<EntityInput>) => void;
  removeEntity: (id: string) => void;
  setDraftEntities: (entities: DraftEntity[]) => void;
  setScenarioParams: (params: Partial<Pick<SimState,
    "heightMinM" | "heightMaxM" | "heightStepM" |
    "angularResolutionDeg" | "gridCellSizeM" |
    "includeTerrain" | "combinationMethod"
  >>) => void;

  startJob: (jobId: string) => void;
  updateJobProgress: (pct: number) => void;
  completeJob: (scenario: ScenarioOut, run: RunOut) => void;
  failJob: (message: string) => void;

  setCurrentHeightM: (h: number) => void;
  setActiveRun: (run: RunOut) => void;
  setPlacingEntityIndex: (idx: number | null) => void;
}

let _entityCounter = 0;
export const newEntityId = () => `entity-${++_entityCounter}`;

export const useSimStore = create<SimState>((set) => ({
  draftName: "New Scenario",
  draftEntities: [],
  heightMinM: 0,
  heightMaxM: 500,
  heightStepM: 10,
  angularResolutionDeg: 0.1,
  gridCellSizeM: 100,
  includeTerrain: true,
  combinationMethod: "max",

  activeScenario: null,
  activeRun: null,
  currentHeightM: 0,

  job: {
    jobId: null,
    progress: null,
    status: "idle",
    errorMessage: null,
  },

  placingEntityIndex: null,

  setDraftName: (name) => set({ draftName: name }),

  addEntity: (entity) =>
    set((s) => ({ draftEntities: [...s.draftEntities, entity] })),

  updateEntity: (id, patch) =>
    set((s) => ({
      draftEntities: s.draftEntities.map((e) =>
        e._id === id ? { ...e, ...patch } : e
      ),
    })),

  removeEntity: (id) =>
    set((s) => ({
      draftEntities: s.draftEntities.filter((e) => e._id !== id),
    })),

  setDraftEntities: (entities) => set({ draftEntities: entities }),

  setScenarioParams: (params) => set(params),

  startJob: (jobId) =>
    set({ job: { jobId, progress: 0, status: "running", errorMessage: null } }),

  updateJobProgress: (pct) =>
    set((s) => ({ job: { ...s.job, progress: pct } })),

  completeJob: (scenario, run) =>
    set((s) => ({
      job: { ...s.job, status: "done", progress: 100 },
      activeScenario: scenario,
      activeRun: run,
      currentHeightM: run.height_min_m,
    })),

  failJob: (message) =>
    set((s) => ({
      job: { ...s.job, status: "error", errorMessage: message },
    })),

  setCurrentHeightM: (h) => set({ currentHeightM: h }),
  setActiveRun: (run) => set({ activeRun: run }),
  setPlacingEntityIndex: (idx) => set({ placingEntityIndex: idx }),
}));
