import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import { useSimStore } from "../store";
import EntityList from "./EntityList";
import "./ScenarioForm.css";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  heightMinM: z.coerce.number().min(0),
  heightMaxM: z.coerce.number().min(1),
  heightStepM: z.coerce.number().min(1).max(1000),
  angularResolutionDeg: z.coerce.number().min(0.01).max(2.0),
  gridCellSizeM: z.coerce.number().min(10).max(10000),
  includeTerrain: z.boolean(),
  combinationMethod: z.enum(["max", "sum"]),
});

type FormValues = z.infer<typeof schema>;

export default function ScenarioForm() {
  const {
    draftName,
    heightMinM,
    heightMaxM,
    heightStepM,
    angularResolutionDeg,
    gridCellSizeM,
    includeTerrain,
    combinationMethod,
    setDraftName,
    setScenarioParams,
  } = useSimStore();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: draftName,
      heightMinM,
      heightMaxM,
      heightStepM,
      angularResolutionDeg,
      gridCellSizeM,
      includeTerrain,
      combinationMethod,
    },
  });

  // Sync form changes to store in real time
  useEffect(() => {
    const sub = watch((values) => {
      if (values.name !== undefined) setDraftName(values.name);
      setScenarioParams({
        heightMinM: values.heightMinM ?? heightMinM,
        heightMaxM: values.heightMaxM ?? heightMaxM,
        heightStepM: values.heightStepM ?? heightStepM,
        angularResolutionDeg: values.angularResolutionDeg ?? angularResolutionDeg,
        gridCellSizeM: values.gridCellSizeM ?? gridCellSizeM,
        includeTerrain: values.includeTerrain ?? includeTerrain,
        combinationMethod: values.combinationMethod ?? combinationMethod,
      });
    });
    return () => sub.unsubscribe();
  }, [watch, setDraftName, setScenarioParams, heightMinM, heightMaxM, heightStepM,
      angularResolutionDeg, gridCellSizeM, includeTerrain, combinationMethod]);

  return (
    <div className="scenario-form">
      <section className="form-section">
        <label className="form-label">
          Scenario Name
          <input
            className="form-input"
            {...register("name")}
            placeholder="e.g. Urban Coverage Study"
          />
          {errors.name && <span className="form-error">{errors.name.message}</span>}
        </label>
      </section>

      <section className="form-section">
        <h3 className="section-title">Entities (Wave Sources)</h3>
        <EntityList />
      </section>

      <section className="form-section">
        <h3 className="section-title">Height Parameters</h3>
        <div className="form-row">
          <label className="form-label">
            Min (m)
            <input className="form-input" type="number" {...register("heightMinM")} />
            {errors.heightMinM && <span className="form-error">{errors.heightMinM.message}</span>}
          </label>
          <label className="form-label">
            Max (m)
            <input className="form-input" type="number" {...register("heightMaxM")} />
            {errors.heightMaxM && <span className="form-error">{errors.heightMaxM.message}</span>}
          </label>
          <label className="form-label">
            Step (m)
            <input className="form-input" type="number" {...register("heightStepM")} />
            {errors.heightStepM && <span className="form-error">{errors.heightStepM.message}</span>}
          </label>
        </div>
      </section>

      <section className="form-section">
        <h3 className="section-title">Simulation Parameters</h3>
        <label className="form-label">
          Angular Resolution (°)
          <input
            className="form-input"
            type="number"
            step="0.01"
            {...register("angularResolutionDeg")}
          />
          {errors.angularResolutionDeg && (
            <span className="form-error">{errors.angularResolutionDeg.message}</span>
          )}
        </label>
        <label className="form-label">
          Grid Cell Size (m)
          <input className="form-input" type="number" {...register("gridCellSizeM")} />
          {errors.gridCellSizeM && (
            <span className="form-error">{errors.gridCellSizeM.message}</span>
          )}
        </label>
        <label className="form-label">
          Combination Method
          <select className="form-input" {...register("combinationMethod")}>
            <option value="max">Max (strongest signal wins)</option>
            <option value="sum">Sum (cumulative)</option>
          </select>
        </label>
        <label className="form-checkbox">
          <input type="checkbox" {...register("includeTerrain")} />
          Include terrain data
        </label>
      </section>
    </div>
  );
}
