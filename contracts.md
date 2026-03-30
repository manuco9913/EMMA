# Contracts

Schema contract between frontend and backend. Tech stack in `system-plan.md`.

## Format & Delivery

JSON Schema draft-07 + `x-` extension properties for UI hints.

Files live in `/contracts/`. Backend serves them at runtime — no rebuild needed on schema change:
- `GET /api/schema/entity`
- `GET /api/schema/scenario`

Frontend derives Zod schemas at runtime from the served JSON Schema.
Backend mirrors the same rules in Pydantic models (manual, by convention).

---

## Type System

| `x-widget` | JSON Schema expression | Renders as |
|---|---|---|
| — | `type: string` | Text input |
| — | `type: number` + min/max/step | Numeric input + `x-unit` suffix |
| — | `type: string, enum: [...]` | Dropdown |
| — | `type: boolean` | Toggle |
| `file` | `type: string` | File path input |
| `coordinate` | `type: object, properties: {lat, lon}` | Lat/lon inputs + map marker |
| `range` | `type: object, properties: {min, max}` | Dual min/max input |
| `matrix` | `type: string` | File upload + read-only preview |
| `value-or-file` | `oneOf: [{type: number}, {type: string}]` | Inline value with toggle to file path |

---

## Conditional Visibility

Any field may declare `x-showIf`. Conditions reference fields within the same object only.

```json
"x-showIf": {
  "and": [
    { "field": "terrain_enabled", "op": "eq", "value": true },
    { "field": "angular_resolution", "op": "lt", "value": 1.0 }
  ]
}
```

Supported ops: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
Top-level key is `and` or `or`. Each entry is `{ field, op, value }`.

---

## Entity Schema Fields

| Field | Type / widget | Constraints |
|---|---|---|
| `label` | string | — |
| `position` | coordinate | lat: −90–90, lon: −180–180 |
| `frequency` | value-or-file | x-unit: MHz |
| `power` | value-or-file | x-unit: dBm |
| `azimuth` | number | min: 0, max: 360, x-unit: ° |
| `antenna_height` | number | min: 0, x-unit: m |
| `radius` | number | min: 0.1, x-unit: km |

## Scenario Schema Fields

| Field | Type / widget | Constraints |
|---|---|---|
| `name` | string | — |
| `height_range` | range | x-unit: m |
| `height_step` | number | min: 1, x-unit: m |
| `angular_resolution` | number | min: 0.01, max: 2.0, default: 0.1, x-unit: ° |
| `grid_cell_size` | number | default: 100, x-unit: m |
| `terrain_enabled` | boolean | default: true |
| `combination_method` | enum | max \| mean \| sum, default: max |
| `entities` | array of entity | 2–10 items |

---

## File-sourced Fields

When `value-or-file` or `matrix` fields use file mode:
- File path is stored as a string reference.
- Backend reads the file from the shared filesystem at job execution time.
- No client-side upload or parsing.
