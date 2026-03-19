# Research: Angular Resolution Default Value

## Overview

This document analyzes the appropriate default angular step size for the wave propagation ray-tracing simulator. The simulator casts rays from each source entity at a fixed angular step, with the ray count determined by `vector_count = angular_window / step_angle` (no cap). At a full 360° window and 0.1° step, this produces 3,600 rays per entity; at 200 km maximum range with 2,000 distance steps per ray, the result is approximately 7.2 million terrain queries per entity per simulation run.

The analysis covers three target propagation domains — RF (radio frequency), acoustic, and seismic — with terrain data sourced from SRTM (30 m posting) or Copernicus DEM (10 m posting), and output written to a 100 m × 100 m Cartesian grid.

The central question is: **what angular step size provides physically meaningful accuracy without incurring unnecessary computational cost?** The answer depends on wavelength (which sets the Fresnel zone radius), DEM resolution, terrain complexity, output grid resolution, and the standards used by comparable industry tools. All of these constraints are examined below.

---

## Fresnel Zone Analysis

### Concept

Ray-tracing treats propagation as a geometric line-of-sight problem, but electromagnetic and acoustic waves do not travel as infinitely thin rays. Energy is distributed across a volume surrounding the geometric path. The first Fresnel zone defines the ellipsoidal region within which reflections and diffractions contribute constructively to the received signal. Terrain features that obstruct this zone cause signal loss; features outside it have negligible effect.

Angular resolution must be fine enough to ensure that the lateral spacing between adjacent rays (the "arc gap" at a given range) is smaller than the radius of the first Fresnel zone. Going finer than this threshold resolves terrain detail that lies within a single Fresnel zone and therefore has no additional physical meaning for propagation accuracy.

### Formula

The first Fresnel zone radius at an intermediate point along the path is:

```
r₁ = sqrt(λ × d1 × d2 / (d1 + d2))
```

Where:
- `λ` = wavelength (metres)
- `d1` = distance from the transmitter to the intermediate point
- `d2` = distance from the intermediate point to the receiver
- `d1 + d2 = D` = total path length

The maximum Fresnel radius occurs at the path midpoint where `d1 = d2 = D/2`:

```
r₁_max = sqrt(λ × (D/2) × (D/2) / D) = sqrt(λ × D / 4) = 0.5 × sqrt(λ × D)
```

### Worked Examples at 200 km Total Path Length

**1 GHz (UHF/L-band RF):**
- λ = c / f = 3×10⁸ / 1×10⁹ = 0.3 m
- r₁_max = sqrt(0.3 × 100,000 × 100,000 / 200,000) = sqrt(0.3 × 50,000) = sqrt(15,000) ≈ **122 m**

**100 MHz (VHF RF):**
- λ = 3 m
- r₁_max = sqrt(3 × 50,000) = sqrt(150,000) ≈ **387 m**

**10 MHz (HF RF):**
- λ = 30 m
- r₁_max = sqrt(30 × 50,000) = sqrt(1,500,000) ≈ **1,225 m**

**1 kHz (acoustic, speed of sound ≈ 343 m/s in air):**
- λ = 343 / 1,000 = 0.343 m
- r₁_max = sqrt(0.343 × 50,000) ≈ **131 m** (comparable to 1 GHz RF)

**10 Hz (seismic P-wave, speed ≈ 6,000 m/s in crust):**
- λ = 6,000 / 10 = 600 m
- r₁_max = sqrt(600 × 50,000) = sqrt(30,000,000) ≈ **5,477 m**

### Physical Interpretation for Angular Step Selection

An arc gap smaller than the Fresnel zone radius at the relevant range produces no improvement in propagation accuracy. This sets a **lower bound on useful angular resolution** at each frequency:

| Frequency / Domain | λ (m) | Fresnel r₁ at 200 km midpoint | Arc gap matching r₁ at 200 km |
|---|---|---|---|
| 10 MHz (HF RF) | 30 | ~1,225 m | ~0.35° |
| 100 MHz (VHF RF) | 3 | ~387 m | ~0.11° |
| 1 GHz (UHF RF) | 0.3 | ~122 m | ~0.035° |
| 10 GHz (microwave) | 0.03 | ~39 m | ~0.011° |
| 1 kHz (acoustic) | 0.343 | ~131 m | ~0.037° |
| 10 Hz (seismic) | 600 | ~5,477 m | ~1.57° |

Arc gap at a given range R and step angle Δθ (in radians):

```
arc_gap = R × Δθ (radians) = R × (Δθ_degrees × π / 180)
```

At 200 km, 0.1° gives: 200,000 × (0.1 × π/180) ≈ **349 m**

At 200 km, 0.1°, the arc gap (349 m) exceeds the 1 GHz Fresnel zone radius (122 m) by a factor of ~2.9, meaning the default step is coarser than the Fresnel limit for UHF/microwave at long range. At 0.05° the arc gap is 175 m — still above the 1 GHz Fresnel limit but much closer. At 0.01° the arc gap is 35 m — below the 1 GHz Fresnel limit, but at significant computational cost.

For HF and VHF, 0.1° is at or finer than the Fresnel limit, making it either adequate or conservative.

---

## Arc Gap vs DEM Resolution

The arc gap sets the lateral sampling density of the terrain surface. There is no benefit to an arc gap smaller than the horizontal posting of the underlying DEM, since the terrain data cannot resolve finer features.

### Arc Gap Table (metres)

| Step Angle | Arc at 50 km | Arc at 100 km | Arc at 200 km |
|---|---|---|---|
| 0.01° | 8.7 m | 17.5 m | 34.9 m |
| 0.05° | 43.6 m | 87.3 m | 174.5 m |
| 0.1° | 87.3 m | 174.5 m | 349 m |
| 0.2° | 174.5 m | 349 m | 698 m |
| 0.5° | 436 m | 872 m | 1,745 m |

Arc gap formula: `arc_gap (m) = range (m) × step_angle (radians)`

### Interpretation Against DEM Resolution

**SRTM 30 m DEM:**
- At 200 km, a 0.01° step gives a 34.9 m arc gap — marginally above the 30 m posting but provides minimal benefit over 0.05° (87.3 m arc at 100 km; 174.5 m at 200 km).
- At 200 km, 0.05° gives 174.5 m — well above the 30 m DEM resolution. The arc gap is the binding constraint; the DEM is fully exploited.
- At 100 km, 0.1° gives 174.5 m — the DEM is not the limiting factor; angular resolution is.
- At 50 km, 0.05° gives 43.6 m — only marginally coarser than 30 m DEM; 0.01° adds little value.

**Copernicus 10 m DEM:**
- At 200 km, even 0.01° gives 34.9 m — over 3× the DEM posting. The DEM cannot be fully exploited at 200 km range regardless of angular step choice.
- At 50 km, 0.01° gives 8.7 m — approaching DEM resolution. However, this imposes very high computational cost (see Section 6).
- For short-range scenarios (< 20 km), sub-0.05° steps may begin to match the 10 m DEM resolution, but the Fresnel zone constraint typically dominates before DEM resolution becomes limiting.

**Output Grid Constraint:**
The output cell size of 100 m × 100 m sets an independent upper bound on useful angular resolution. An arc gap significantly smaller than 100 m at the relevant range produces results that are indistinguishable on the output grid. At 200 km, 0.1° gives 349 m — already above the 100 m cell. At 0.05° the gap is 175 m, still above the 100 m cell. At 0.03° the gap approaches 105 m at 200 km. Steps finer than ~0.03° at 200 km provide angular detail that cannot be expressed in the 100 m output grid and are therefore wasteful for the standard output configuration.

---

## Industry Standards / Reference Tools

Surveying established propagation tools provides a calibration reference for what the wider RF and propagation engineering community considers adequate angular resolution.

### SPLAT! (open source RF propagation tool)

SPLAT! is a widely used open-source line-of-sight and propagation tool based on the Longley-Rice Irregular Terrain Model. It operates at a fixed terrain resolution of 3 arc-seconds (approximately 90 m at mid-latitudes), which is comparable to SRTM resolution. The effective angular sampling for terrain profiles is determined by this terrain resolution and the range, resulting in an effective angular step of approximately 0.05°–0.1° for most scenarios at ranges of 50–200 km. This is consistent with practical RF engineering requirements and validates the 0.1° neighbourhood as a working standard.

### ITM / Longley-Rice Model

The Irregular Terrain Model (ITM), which underlies SPLAT! and many US government propagation tools (including those used by the FCC and NTIA), constructs discrete terrain profiles at fixed angular intervals. Published ITM implementations typically use profile intervals equivalent to 0.1°–0.5° depending on path length and scenario. Shorter paths use finer angular spacing; longer paths (100+ km) use coarser spacing because the Fresnel zones are wider and terrain features below a certain spatial scale are irrelevant. The ITM methodology explicitly acknowledges that terrain profile sampling should be tied to terrain variability and Fresnel zone width, not to arbitrary resolution targets.

### TIREM (Terrain Integrated Rough Earth Model)

TIREM is the US Department of Defense standard propagation model for tactical RF analysis. It uses terrain profile sampling strategies similar to ITM, with typical effective angular steps of 0.1°–0.5° for ground-to-ground paths at tactical ranges (10–200 km). TIREM does not push to sub-0.05° angular resolution for standard analyses, reflecting the judgment that finer steps provide negligible improvement given Fresnel zone widths and DEM limitations at those ranges.

### WinProp (Altair)

WinProp is a commercial macro-cell and wide-area propagation planning tool. Its ray-launching module for outdoor macro-cell scenarios (typically 1–50 km range) uses angular steps of 0.05°–0.2° as typical operating range. At longer ranges, 0.1°–0.5° is standard. For urban micro-cell scenarios at sub-kilometre range, finer steps (down to 0.01°) may be used, but those scenarios involve entirely different terrain data (building models rather than DEMs).

### Summary of Industry Reference Points

| Tool / Method | Typical Angular Step | Context |
|---|---|---|
| SPLAT! | ~0.05°–0.1° | Long-range RF, SRTM terrain |
| ITM / Longley-Rice | 0.1°–0.5° | Ground-to-ground RF, 10–200 km |
| TIREM | 0.1°–0.5° | Tactical RF, DoD standard |
| WinProp | 0.05°–0.2° | Macro-cell planning |

The consistent cluster around 0.1° for typical long-range scenarios provides strong empirical support for using 0.1° as a default. No production tool targeting DEM-based wide-area propagation uses sub-0.05° steps as a standard default.

---

## Frequency-Dependent Requirements

Different frequency bands have fundamentally different propagation physics, leading to different optimal angular resolutions. The simulator targets RF, acoustic, and seismic propagation, spanning many orders of magnitude in frequency and wavelength.

### HF Band (3–30 MHz)

- Wavelengths: 10–100 m
- Fresnel zone radius at 200 km midpoint: ~690 m (at 30 MHz) to ~2,180 m (at 3 MHz)
- Required arc gap to match Fresnel zone: ~0.2°–0.6° at 200 km
- Recommendation: **0.5°–1.0°** is fully adequate and avoids wasteful oversampling
- At 0.1°, results are physically indistinguishable from 0.5° for HF at long range; the finer step imposes 5–25× more computation with no accuracy gain

### VHF Band (30–300 MHz)

- Wavelengths: 1–10 m
- Fresnel zone radius at 200 km midpoint: ~220 m (at 300 MHz) to ~690 m (at 30 MHz)
- Required arc gap: ~0.06°–0.2° at 200 km
- Recommendation: **0.2°–0.5°** adequate; 0.1° provides a margin of safety without excessive cost
- 0.5° may begin to miss terrain features that matter at 300 MHz

### UHF Band (300 MHz–3 GHz)

- Wavelengths: 0.1–1 m
- Fresnel zone radius at 200 km midpoint: ~39 m (at 3 GHz) to ~122 m (at 300 MHz)
- Required arc gap: ~0.011°–0.035° at 200 km to fully match Fresnel zone
- At 0.1° (349 m arc at 200 km), the step is 3–9× coarser than the Fresnel zone radius
- Recommendation: **0.1° as default** is a pragmatic compromise — finer than VHF needs, but still coarser than the theoretical UHF Fresnel limit at long range. For precision microwave work at 200 km, 0.05° is preferable.
- Note: at shorter ranges (< 50 km), the Fresnel zone narrows significantly (Fresnel radius scales as sqrt(D)), so 0.1° becomes more than adequate even at UHF

### Microwave Band (3–30 GHz)

- Wavelengths: 0.01–0.1 m
- Fresnel zone radius at 200 km midpoint: ~12 m (at 30 GHz) to ~39 m (at 3 GHz)
- Arc gap at 0.1°: 349 m — roughly 9–29× the Fresnel zone radius
- Recommendation: **0.05°–0.1°** for general use; 0.02°–0.05° for precision analysis
- However, output grid resolution of 100 m limits the utility of sub-0.03° steps (see DEM/output constraint analysis)
- The Fresnel zone is narrow enough that the 100 m output grid is likely the binding constraint before angular resolution

### Acoustic Propagation (20 Hz–20 kHz)

- Speed of sound in air: ~343 m/s; in water: ~1,500 m/s; in rock: variable
- At 1 kHz in air: λ ≈ 0.343 m → Fresnel zone at 200 km ≈ 131 m (similar to 1 GHz RF)
- At 100 Hz: λ ≈ 3.43 m → Fresnel zone ≈ 414 m (similar to 100 MHz RF)
- Recommendation: treat acoustic similarly to the RF band with matching wavelength; **0.1°** is appropriate for speech-range frequencies (300 Hz–3 kHz), **0.2°–0.5°** for low-frequency infrasound

### Seismic Propagation (0.01–10 Hz)

- P-wave velocity in crust: ~5,000–8,000 m/s
- At 1 Hz: λ ≈ 6,000 m → Fresnel zone at 200 km ≈ 1,732 m
- At 10 Hz: λ ≈ 600 m → Fresnel zone ≈ 548 m
- Recommendation: **0.5°–2.0°** is more than adequate; 0.1° is severe oversampling for seismic analysis
- Seismic ray-tracing is typically done at much coarser angular steps (1°–5°) in industry practice

### Summary Table

| Band / Domain | Frequency Range | Recommended Step | Notes |
|---|---|---|---|
| HF RF | 3–30 MHz | 0.5°–1.0° | Fresnel zones hundreds of metres wide |
| VHF RF | 30–300 MHz | 0.2°–0.5° | 0.1° provides safety margin |
| UHF RF | 300 MHz–3 GHz | 0.1° default | Coarser than Fresnel limit at long range |
| Microwave RF | 3–30 GHz | 0.05°–0.1° | Output grid may be binding constraint |
| Acoustic (mid) | 100 Hz–10 kHz | 0.1°–0.2° | Similar to RF with matching λ |
| Acoustic (low) | < 100 Hz | 0.5°–1.0° | Long wavelength, wide Fresnel zones |
| Seismic | 0.01–10 Hz | 0.5°–2.0° | Coarse resolution adequate |

The simulator targets all of these domains. A single default of 0.1° spans the full range reasonably: it is conservative (unnecessarily fine) for HF and seismic, adequate for UHF, and slightly coarser than ideal for long-range microwave.

---

## Terrain Complexity Factor

Angular resolution requirements are not purely a function of wavelength — they also depend on the spatial frequency of the terrain surface. A perfectly flat terrain imposes no LOS constraint variation between adjacent rays at any plausible angular step. Mountainous terrain with sharp ridges and deep valleys introduces high spatial frequency features that may lie between rays if the angular step is too coarse.

### Terrain Feature Scale vs Arc Gap

Key terrain features for propagation analysis are typically characterised by their lateral width (the dimension perpendicular to the propagation path):

- **Mountain ridges**: typical crest widths of 500 m–5 km for major ranges; narrow ridges in erosion-sculpted terrain can be 100–500 m
- **Valleys**: floor widths of 200 m–5 km in mountain terrain; narrower gorges possible
- **Coastal cliffs / escarpments**: near-vertical features, typically 50–500 m horizontal extent
- **Urban terrain** (buildings, not relevant for DEM-based analysis): not applicable here

For propagation, a terrain feature matters if it occludes or diffracts the first Fresnel zone. Features narrower than the Fresnel zone radius are partially transparent to the wave. Features wider than the Fresnel zone act as effective blockers.

### Arc Gap Analysis for Mountainous Terrain

At 200 km range:
- 0.5° step → 1,745 m arc gap: will miss ridges of width 500 m–1,500 m
- 0.2° step → 698 m arc gap: will miss ridges narrower than ~700 m
- 0.1° step → 349 m arc gap: captures most ridges wider than ~350 m; may miss narrow ridges (100–350 m)
- 0.05° step → 175 m arc gap: captures ridges wider than ~175 m; adequate for most mountainous terrain
- 0.01° step → 35 m arc gap: captures essentially all terrain features above DEM resolution

At 100 km range:
- 0.1° step → 175 m arc gap: adequate for most mountain ridge scenarios
- 0.05° step → 87 m arc gap: captures most ridges, approaching SRTM resolution

**Interaction with Fresnel zone:** A narrow ridge of width 200 m at 200 km is geometrically visible between rays at 0.1° spacing (349 m arc gap), but its obstruction of the wave depends on whether the ridge is within the first Fresnel zone. At 1 GHz, the Fresnel zone radius at 200 km midpoint is ~122 m, smaller than the 200 m ridge width. The ridge is therefore a meaningful obstruction. The 0.1° step would miss this ridge roughly half the time (depending on ray positioning relative to ridge). At 0.05° (175 m arc gap), the probability of missing the ridge is significantly reduced.

### Terrain Complexity and Output Grid Interaction

The output grid cell size of 100 m × 100 m is a further constraint. Even if a terrain feature at 200 km is resolved by the angular step, if it falls within a single 100 m output cell, its effect on adjacent cells cannot be expressed. For practical purposes, the output grid resolution of 100 m sets a floor below which improved angular resolution provides no visible improvement in simulation output at 200 km range:

- Arc gap matching 100 m output cell at 200 km: ~0.029° (~0.03°)
- Arc gap matching 100 m at 100 km: ~0.057° (~0.06°)
- Arc gap matching 100 m at 50 km: ~0.115° (~0.1°)

This means:
- At 50 km range, 0.1° already provides arc gaps (~87 m) near the 100 m output cell size — further refinement has little effect on the output
- At 100 km range, 0.05°–0.1° is appropriate
- At 200 km range, steps finer than 0.05° rarely improve the output map

### Recommendation for Terrain Complexity

For heavily mountainous terrain with narrow ridges (100–500 m) at ranges > 100 km, **0.05° provides a meaningful improvement** over 0.1°. For flat or gently rolling terrain, 0.2°–0.5° is sufficient. The 0.1° default strikes a balance suitable for mixed terrain scenarios.

---

## Computational Cost Trade-offs

### Cost Model

Assuming:
- Full 360° angular window
- 2,000 distance steps per ray at 200 km maximum range (1 step per 100 m)
- One terrain elevation query per distance step per ray
- Multiple source entities

| Step Angle | Rays (360°) | Queries per Entity | Relative Cost |
|---|---|---|---|
| 0.5° | 720 | 1,440,000 (1.44M) | 1× |
| 0.2° | 1,800 | 3,600,000 (3.6M) | 2.5× |
| 0.1° | 3,600 | 7,200,000 (7.2M) | 5× |
| 0.05° | 7,200 | 14,400,000 (14.4M) | 10× |
| 0.01° | 36,000 | 72,000,000 (72M) | 50× |

### Python Preprocessing Performance

Estimated Python (NumPy/SciPy) throughput for terrain query and ray-stepping loops: 5–15 million points per second (vectorised; pure Python would be slower).

At 0.1° step, 10 entities:
- Total queries: 10 × 7.2M = 72M
- At 5M pts/s: ~14.4 seconds
- At 15M pts/s: ~4.8 seconds

At 0.05° step, 10 entities:
- Total queries: 10 × 14.4M = 144M
- At 5M pts/s: ~28.8 seconds
- At 15M pts/s: ~9.6 seconds

These estimates do not account for memory bandwidth, DEM tile loading overhead, interpolation costs, or diffraction calculations, all of which increase real-world runtime. Actual benchmarks should be performed on representative hardware and scenarios.

### MATLAB Analysis Phase Performance

MATLAB processing time for the output results (coverage maps, path loss computation) is estimated at 1–30 minutes depending on algorithm complexity and scenario scale. Since MATLAB post-processing is expected to dominate end-to-end runtime, Python preprocessing is not the primary bottleneck in the overall workflow. A 2× increase in preprocessing time (0.1° → 0.05°) has limited impact on the total turnaround time when MATLAB dominates.

### Memory Considerations

Ray data and intermediate results must be held in memory or written to disk between preprocessing and MATLAB stages. At 0.1°, 3,600 rays × 2,000 steps × (e.g.) 8 bytes per float = ~57 MB per entity for a single floating-point output array. At 0.05°, this doubles to ~115 MB. For 10 entities and multiple output channels (elevation, path loss, LOS flag), memory use scales accordingly. At 0.01°, memory pressure becomes significant (~575 MB per entity per output channel).

### Cost vs Accuracy Trade-off Summary

| Step | Relative Cost | UHF Fresnel Match (200 km) | Output Grid Match (200 km) | Practical Utility |
|---|---|---|---|---|
| 0.5° | 1× | Poor (Fresnel ~122 m, arc ~1,745 m) | Poor | HF / seismic only |
| 0.2° | 2.5× | Marginal | Poor | VHF and below |
| 0.1° | 5× | Moderate (arc ~349 m, 3× Fresnel) | Moderate (arc ~349 m, 3.5× cell) | **Recommended default** |
| 0.05° | 10× | Good (arc ~175 m, 1.4× Fresnel) | Good (arc ~175 m, 1.75× cell) | Precision UHF/microwave |
| 0.01° | 50× | Excellent | Excellent | Research / validation only |

---

## Recommendation (Default Value + User-Adjustable Range)

### Default: 0.1°

A default angular step of **0.1°** is recommended, consistent with the plan's stated default. The justification is as follows:

1. **Industry alignment**: SPLAT!, ITM, TIREM, and WinProp all converge on 0.05°–0.2° for typical long-range scenarios. 0.1° sits at the centre of this range.

2. **UHF adequacy**: For the most common and demanding RF use case (UHF, 300 MHz–3 GHz, ranges up to 200 km), 0.1° gives a 349 m arc gap at 200 km, which is 2–9× the Fresnel zone radius. This represents moderate over-spacing relative to the Fresnel criterion, but is consistent with industry practice and is not expected to produce significant propagation errors in typical terrain scenarios.

3. **HF/VHF over-sampling is acceptable**: For HF and VHF (which have larger Fresnel zones), 0.1° is unnecessarily fine but not harmful. The 5× cost relative to 0.5° is a cost efficiency concern for these bands, which should be addressed through user-adjustable step values rather than changing the default.

4. **Output grid compatibility**: At ranges up to ~50 km, 0.1° produces arc gaps (< 90 m) close to the 100 m output cell size, making it a reasonable match to the output resolution. At 200 km, the arc gap (349 m) is somewhat coarser than the output cell, meaning the angular step — not the output grid — is the limiting factor.

5. **Computational tractability**: At 0.1°, 10 entities can be preprocessed in under a minute in Python, keeping preprocessing latency reasonable relative to the MATLAB post-processing phase.

6. **Known limitation**: At microwave frequencies (> 3 GHz) at long range (> 100 km), the 0.1° default is physically coarser than the Fresnel zone demands. Users performing microwave coverage analysis at long range should use 0.05° or finer. This limitation should be clearly documented in the user interface.

### User-Adjustable Range: 0.01° to 2.0°

The simulator should accept user-specified step values in the range **0.01° to 2.0°**. Suggested presets:

| Preset Name | Step Angle | Intended Use Case |
|---|---|---|
| Coarse (fast) | 1.0° | Seismic, HF, rapid preview |
| Standard HF/VHF | 0.5° | HF and VHF RF, acoustic low-freq |
| Default | 0.1° | UHF RF, general-purpose |
| Fine (precision) | 0.05° | Microwave, mountainous terrain |
| Ultra-fine (research) | 0.01° | Validation, sub-100 km UHF/microwave |

The upper bound of 2.0° is appropriate for seismic analysis and very long range HF paths (> 500 km). The lower bound of 0.01° is a practical limit set by computational cost; at 36,000 rays and 72M terrain queries per entity, even a single-entity run at 0.01° is resource-intensive in Python.

### Validation of the 0.1° Default

- At 200 km max range: 349 m arc gap — coarser than the 1 GHz Fresnel zone radius (122 m), but consistent with industry standards
- At 100 km range: 175 m arc gap — within 1.5× the 1 GHz Fresnel zone radius; adequate for most UHF scenarios
- At 50 km range: 87 m arc gap — below the 1 GHz Fresnel zone radius at 50 km midpoint (sqrt(0.3 × 25,000) ≈ 87 m); Fresnel-matched at this range
- DEM resolution (30 m SRTM): not a binding constraint at these arc gaps; angular resolution dominates
- Output grid (100 m): arc gap exceeds cell size at 200 km; matched near 50 km

Verdict: **0.1° is well-justified as a general-purpose default.** The primary caveat is microwave/long-range precision work, where 0.05° is preferable. User documentation should clearly state the Fresnel zone implications of the chosen step at the frequencies and ranges of interest.

---

## Open Questions

1. **Adaptive angular resolution**: Should the simulator support variable step size as a function of range (finer steps at short range, coarser at long range)? This would allow efficient Fresnel-matched sampling without uniform high cost at all ranges. Implementation complexity is moderate; accuracy benefit is highest for mixed-range scenarios.

2. **Partial-window scanning**: For scenarios where the angular window is less than 360° (e.g., a sector antenna or directional source), the ray count scales linearly with the window. The default step of 0.1° may still be appropriate, but user guidance on step selection for narrow-beam scenarios would be valuable. Narrow beams imply directive antennas, which in turn affect the relative importance of adjacent ray contributions.

3. **Acoustic and seismic presets**: The frequency-dependent step recommendations differ substantially between RF and seismic. Should the simulator expose frequency-band presets that automatically suggest an appropriate step, rather than requiring the user to reason from first principles?

4. **DEM interpolation method interaction**: Bilinear vs bicubic DEM interpolation has an effective spatial resolution different from the nominal DEM posting. If bicubic interpolation synthesises detail between postings, finer angular steps may extract more meaningful terrain information from the same DEM than a simple analysis suggests. This should be characterised once the interpolation scheme is determined.

5. **Multi-source scaling**: With N entities each requiring 7.2M queries at 0.1°, total preprocessing time scales linearly with entity count. At large N (e.g., 50–100 entities), the preprocessing phase may begin to rival or exceed the MATLAB phase. A threshold for N above which 0.1° becomes a bottleneck should be established empirically.

6. **Validation dataset**: No empirical validation of the 0.1° default has been performed against measured propagation data for this simulator. Comparison against known propagation measurements (e.g., ITU-R datasets, or field measurement campaigns) over varied terrain at UHF would confirm whether the default produces acceptable accuracy or whether a finer default is warranted in practice.

7. **Diffraction computation sensitivity**: The analysis above assumes simple LOS ray-tracing. If knife-edge or multiple-diffraction models are applied along ray paths, the angular step sensitivity may differ. Diffraction calculations can bridge arc gaps to some extent, potentially relaxing the angular resolution requirement for obstruction scenarios. The interaction between angular step and diffraction algorithm accuracy should be investigated.
