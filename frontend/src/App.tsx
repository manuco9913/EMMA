import { MapComponent } from './Map'
import { ScenarioPanel } from './ScenarioPanel'
import { HeightSlider } from './HeightSlider'

export default function App() {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <ScenarioPanel />
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <MapComponent />
        <HeightSlider />
      </div>
    </div>
  )
}
