import { useSimStore, newEntityId } from "../store";
import type { DraftEntity } from "../store";
import "./EntityList.css";

const DEFAULT_ENTITY: Omit<DraftEntity, "_id"> = {
  lat: 0,
  lon: 0,
  radius_km: 50,
  frequency_hz: 900_000_000,
  power_w: 10,
  azimuth_deg: 0,
  antenna_height_m: 30,
};

export default function EntityList() {
  const {
    draftEntities,
    addEntity,
    updateEntity,
    removeEntity,
    setPlacingEntityIndex,
    placingEntityIndex,
  } = useSimStore();

  const handleAdd = () => {
    if (draftEntities.length >= 10) return;
    addEntity({ ...DEFAULT_ENTITY, _id: newEntityId() });
  };

  return (
    <div className="entity-list">
      {draftEntities.map((entity, idx) => (
        <EntityCard
          key={entity._id}
          entity={entity}
          index={idx}
          isPlacing={placingEntityIndex === idx}
          onUpdate={(patch) => updateEntity(entity._id, patch)}
          onRemove={() => removeEntity(entity._id)}
          onPlace={() =>
            setPlacingEntityIndex(placingEntityIndex === idx ? null : idx)
          }
        />
      ))}

      {draftEntities.length < 10 && (
        <button className="add-entity-btn" onClick={handleAdd}>
          + Add Entity
        </button>
      )}

      {draftEntities.length === 0 && (
        <p className="entity-hint">Add at least one entity to run a simulation.</p>
      )}
    </div>
  );
}

interface EntityCardProps {
  entity: DraftEntity;
  index: number;
  isPlacing: boolean;
  onUpdate: (patch: Partial<DraftEntity>) => void;
  onRemove: () => void;
  onPlace: () => void;
}

function EntityCard({
  entity,
  index,
  isPlacing,
  onUpdate,
  onRemove,
  onPlace,
}: EntityCardProps) {
  const positioned = entity.lat !== 0 || entity.lon !== 0;

  return (
    <div className={`entity-card ${isPlacing ? "placing" : ""}`}>
      <div className="entity-header">
        <span className="entity-number">Entity {index + 1}</span>
        <div className="entity-actions">
          <button
            className={`place-btn ${isPlacing ? "active" : ""} ${positioned ? "positioned" : ""}`}
            onClick={onPlace}
            title="Click to place on map"
          >
            {isPlacing ? "Cancel" : positioned ? `📍 ${entity.lat.toFixed(3)}, ${entity.lon.toFixed(3)}` : "📍 Place on map"}
          </button>
          <button className="remove-btn" onClick={onRemove} title="Remove entity">
            ✕
          </button>
        </div>
      </div>

      <div className="entity-fields">
        <FieldRow label="Radius (km)">
          <input
            type="number"
            className="entity-input"
            value={entity.radius_km}
            min={1}
            max={500}
            onChange={(e) => onUpdate({ radius_km: Number(e.target.value) })}
          />
        </FieldRow>
        <FieldRow label="Frequency (MHz)">
          <input
            type="number"
            className="entity-input"
            value={entity.frequency_hz / 1e6}
            min={1}
            onChange={(e) => onUpdate({ frequency_hz: Number(e.target.value) * 1e6 })}
          />
        </FieldRow>
        <FieldRow label="Power (W)">
          <input
            type="number"
            className="entity-input"
            value={entity.power_w}
            min={0.001}
            onChange={(e) => onUpdate({ power_w: Number(e.target.value) })}
          />
        </FieldRow>
        <FieldRow label="Azimuth (°)">
          <input
            type="number"
            className="entity-input"
            value={entity.azimuth_deg}
            min={0}
            max={359}
            onChange={(e) => onUpdate({ azimuth_deg: Number(e.target.value) })}
          />
        </FieldRow>
        <FieldRow label="Antenna height (m)">
          <input
            type="number"
            className="entity-input"
            value={entity.antenna_height_m}
            min={1}
            onChange={(e) => onUpdate({ antenna_height_m: Number(e.target.value) })}
          />
        </FieldRow>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="entity-field">
      <span className="entity-field-label">{label}</span>
      {children}
    </label>
  );
}
