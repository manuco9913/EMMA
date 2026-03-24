import { useSimStore } from "../store";
import "./HeightSlider.css";

interface Props {
  min: number;
  max: number;
  step: number;
}

export default function HeightSlider({ min, max, step }: Props) {
  const { currentHeightM, setCurrentHeightM } = useSimStore();

  const levels = Math.max(1, Math.round((max - min) / step) + 1);
  const clamped = Math.max(min, Math.min(max, currentHeightM));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentHeightM(Number(e.target.value));
  };

  const handleNumericInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!isNaN(v)) setCurrentHeightM(Math.max(min, Math.min(max, v)));
  };

  return (
    <div className="height-slider-container">
      <div className="height-slider-header">
        <span className="height-slider-label">Height</span>
        <div className="height-value-row">
          <input
            type="number"
            className="height-numeric"
            value={clamped}
            min={min}
            max={max}
            step={step}
            onChange={handleNumericInput}
          />
          <span className="height-unit">m AGL</span>
        </div>
      </div>

      <input
        type="range"
        className="height-range"
        min={min}
        max={max}
        step={step}
        value={clamped}
        onChange={handleChange}
      />

      <div className="height-slider-ticks">
        <span>{min}m</span>
        <span>{Math.round((min + max) / 2)}m</span>
        <span>{max}m</span>
      </div>

      <p className="height-info">{levels} height levels</p>
    </div>
  );
}
