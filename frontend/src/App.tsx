import { useState } from "react";
import MapView from "./map/MapView";
import ScenarioPanel from "./scenario/ScenarioPanel";
import "./App.css";

export default function App() {
  const [panelOpen, setPanelOpen] = useState(true);

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <span className="app-title">Wave Propagation Simulator</span>
      </header>
      <div className="app-container">
      <div className={`sidebar ${panelOpen ? "open" : "collapsed"}`}>
        <button
          className="sidebar-toggle"
          onClick={() => setPanelOpen((v) => !v)}
          title={panelOpen ? "Collapse panel" : "Expand panel"}
        >
          {panelOpen ? "◀" : "▶"}
        </button>
        {panelOpen && <ScenarioPanel />}
      </div>
      <div className="map-area">
        <MapView />
      </div>
    </div>
    </div>
  );
}
