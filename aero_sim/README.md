# AeroSim — Flight Fuel-Burn Simulation

Interactive 3D replay of an A320-family flight from London Heathrow (LHR) to
New York JFK (JFK). It visualizes saved fuel-burn labels, a Physics baseline,
and AeroTwin R3 predictions on a Cesium globe.

The frontend is built with **CesiumJS** and **Vite**. The current replay is a
bundled demo dataset; no backend API is required to run the interface.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To create a production build:

```bash
npm run build
```

## Data provenance and scope

The UI deliberately distinguishes between four kinds of information:

- **Saved replay data** — per-interval measured fuel labels, Physics baseline
  estimates, AeroTwin R3 predictions, and available flight telemetry. These
  are loaded from `public/models/demo_flight.json` through `src/data/routes.js`.
- **Frontend-derived values** — cumulative fuel, mass, wing loading, phase
  timing, chart summaries, and report statistics calculated in the browser.
- **Static evaluation snapshot** — benchmark RMSE values shown in the
  Before-vs-After view. These are aggregate evaluation values, not accuracy
  guarantees for this one flight replay.
- **Demo-only visuals** — the weather layer, cloud banks, wind arrows, and
  portions of the route profile exist to explain the interface and are not
  live telemetry or live weather.

## Current limitations

- One bundled LHR → JFK A320-family replay is currently available.
- The application is a visualization and analysis demo, not an operational
  dispatch, aircraft-tracking, or weather product.
- The report's phase timing follows the frontend simulation profile; it should
  not be interpreted as a certified aircraft operations record.
- The A320-family model is a visual asset; see `public/assets/ATTRIBUTION.md`
  for its attribution and licence.

## Features

- 3D globe with terrain, lighting, and a real great-circle-ish route
- Animated aircraft following the route; camera auto-follows
- Route polyline plus per-segment markers **colored by predicted fuel burn**
  (green = low, orange = medium, red = high) with fuel-kg labels
- HUD: progress %, fuel used, fuel remaining, distance, prediction engine
- Three.js fuel-tank gauge animating with remaining fuel
- **Two prediction engines:**
  1. **ONNX Runtime Web** — the real exported student model (`public/models/`)
  2. **Physics fallback** — used automatically when the ONNX files are absent

## Using the real model

The simulator auto-detects `public/models/large_mlp.onnx` +
`large_mlp.preproc.json`. See [`public/models/README.md`](public/models/README.md)
for how to export them from the project's distillation checkpoints
(`experiments/11_onnx_deploy/export_onnx.py`). Without them, the physics
fallback keeps the demo running.

## Project layout

```
aero_sim/
├── index.html                 # App shell + HUD
├── package.json
├── vite.config.js             # Vite + Cesium plugin
├── public/
│   └── models/                # Drop exported .onnx + preproc.json here
└── src/
    ├── main.js                # Cesium viewer, route, animation, wiring
    ├── fuel.js                # FuelPredictor: ONNX + physics fallback
    ├── threeScene.js          # Three.js fuel-gauge overlay
    └── data/
        └── routes.js          # Sample routes (EGLL→KJFK, KSFO→KORD)
```
