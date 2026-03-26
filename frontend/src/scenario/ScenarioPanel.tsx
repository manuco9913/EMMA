import { useState } from "react";
import { useSimStore, type SimState } from "../store";
import ScenarioForm from "./ScenarioForm";
import HeightSlider from "./HeightSlider";
import { apiClient } from "../api/client";
import "./ScenarioPanel.css";

type Tab = "setup" | "results";

export default function ScenarioPanel() {
  const [tab, setTab] = useState<Tab>("setup");
  const {
    job,
    activeRun,
    draftName,
    draftEntities,
    heightMinM,
    heightMaxM,
    heightStepM,
    angularResolutionDeg,
    gridCellSizeM,
    includeTerrain,
    combinationMethod,
    pathLossExp,
    noiseStdDb,
    startJob,
    updateJobProgress,
    completeJob,
    failJob,
  } = useSimStore();

  const canRun = draftEntities.length >= 1 && draftEntities.some((e) => e.lat !== 0 || e.lon !== 0);

  const handleRun = async () => {
    if (!canRun) return;

    const entities = draftEntities.map(({ _id: _, ...rest }) => rest);

    try {
      const resp = await apiClient.createScenario({
        name: draftName,
        entities,
        height_min_m: heightMinM,
        height_max_m: heightMaxM,
        height_step_m: heightStepM,
        angular_resolution_deg: angularResolutionDeg,
        grid_cell_size_m: gridCellSizeM,
        include_terrain: includeTerrain,
        combination_method: combinationMethod,
        path_loss_exp: pathLossExp,
        noise_std_db: noiseStdDb,
      });

      startJob(resp.job_id);
      setTab("results");

      // Open SSE
      const es = new EventSource(`/api/jobs/${resp.job_id}/events`);

      es.onmessage = async (evt) => {
        const data = JSON.parse(evt.data);

        if (data.type === "progress") {
          updateJobProgress(data.pct as number);
        } else if (data.type === "done") {
          es.close();
          // Fetch the full scenario to get run details
          const scenario = await apiClient.getScenario(data.scenario_id as string);
          const run = scenario.runs.find((r) => r.id === data.run_id);
          if (run) {
            completeJob(scenario, run);
          }
        } else if (data.type === "error") {
          es.close();
          failJob(data.message as string);
        }
      };

      es.onerror = () => {
        es.close();
        failJob("Lost connection to server");
      };
    } catch (err) {
      failJob(String(err));
    }
  };

  return (
    <div className="scenario-panel">
      <header className="panel-header">
        <h1>Wave Propagation Simulator</h1>
        <div className="panel-tabs">
          <button
            className={tab === "setup" ? "active" : ""}
            onClick={() => setTab("setup")}
          >
            Setup
          </button>
          <button
            className={tab === "results" ? "active" : ""}
            onClick={() => setTab("results")}
            disabled={!activeRun && job.status === "idle"}
          >
            Results
          </button>
        </div>
      </header>

      <div className="panel-body">
        {tab === "setup" && <ScenarioForm />}
        {tab === "results" && (
          <ResultsPanel
            activeRun={activeRun}
            job={job}
          />
        )}
      </div>

      <footer className="panel-footer">
        {tab === "setup" && (
          <button
            className="run-btn"
            onClick={handleRun}
            disabled={!canRun || job.status === "running"}
          >
            {job.status === "running" ? (
              <>Running… {job.progress !== null ? `${job.progress}%` : ""}</>
            ) : (
              "▶ Run Simulation"
            )}
          </button>
        )}
      </footer>
    </div>
  );
}

function ResultsPanel({
  activeRun,
  job,
}: {
  activeRun: SimState["activeRun"];
  job: SimState["job"];
}) {
  if (job.status === "running") {
    return (
      <div className="results-waiting">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${job.progress ?? 0}%` }}
          />
        </div>
        <p>Simulating… {job.progress ?? 0}%</p>
      </div>
    );
  }

  if (job.status === "error") {
    return (
      <div className="results-error">
        <p>❌ Simulation failed</p>
        <pre>{job.errorMessage}</pre>
      </div>
    );
  }

  if (!activeRun) {
    return (
      <div className="results-empty">
        <p>No results yet. Run a simulation first.</p>
      </div>
    );
  }

  return (
    <div className="results-content">
      <section className="result-info">
        <p>
          <strong>Height range:</strong> {activeRun.height_min_m}m –{" "}
          {activeRun.height_max_m}m (step {activeRun.height_step_m}m)
        </p>
        {activeRun.bbox_west !== null && (
          <p className="bbox-info">
            Bbox: [{activeRun.bbox_west?.toFixed(3)},{" "}
            {activeRun.bbox_south?.toFixed(3)}] → [{activeRun.bbox_east?.toFixed(3)},{" "}
            {activeRun.bbox_north?.toFixed(3)}]
          </p>
        )}
      </section>
      <HeightSlider
        min={activeRun.height_min_m}
        max={activeRun.height_max_m}
        step={activeRun.height_step_m}
      />
    </div>
  );
}
