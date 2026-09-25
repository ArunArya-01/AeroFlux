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

- Cesium 3D globe, continuous A320-family animation, and LHR/JFK markers
- Overview and Follow camera modes, including a draggable full-route mini-map
- Live phase label above the aircraft: Takeoff, Climb, Cruise, Descent, or Landing
- Clickable flight-event timeline and scrubber
- Live aircraft hover telemetry: altitude, speed, heading, and replay ETA
- Dynamic mass, fuel, aerodynamic-force, and prediction panels
- Cumulative and burn-rate chart views, with overlay and split-comparison modes
- Expanded prediction chart and Before-vs-After static benchmark comparison
- Route heatmap for travelled path: burn rate, altitude, or R3 prediction error
- Optional demo weather layer with wind, cloud, temperature, and turbulence indicators
- Mission-control command palette via <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd>
- Focus mode, light theme, metric explanation tooltips, keyboard focus styles,
  and reduced-motion support
- Mobile-only Flight/Data bottom sheets that keep the globe visible

## Controls

| Control | What it does |
| --- | --- |
| Follow / Overview | Switch between the close aircraft camera and the full North Atlantic route. |
| Timeline and phase buttons | Scrub the replay or jump directly to a flight phase. |
| Route colour | Colour only the travelled route by burn rate, altitude, or R3 error. |
| Weather | Toggle the clearly marked demo atmosphere layer. |
| Hover the A320 | Show live altitude, speed, heading, and remaining replay time. |
| Drag the mini-map | Reposition the circular mini-map while in Follow mode. |
| ⌘/Ctrl + K | Open the searchable mission-control command palette. |

## End-of-flight report and exports

When the replay finishes, select **Open report** from the completion dialog.
The report includes:

- Flight event ledger and phase-by-phase mission debrief
- Fuel, mass, aerodynamic state, and flight extremes
- Measured-vs-Physics-vs-R3 comparison tables
- Cumulative, interval fuel-burn, and interval error charts
- Prediction-quality statistics across the complete replay

Use **Print / save PDF** for a multi-page report. The PDF uses a dedicated
high-contrast chart palette: black measured trace, dark-grey dashed Physics
baseline, and red R3 trace. CSV exports the interval rows; JSON exports the
event ledger, phase summary, and interval data.

## Project layout

```
aero_sim/
├── index.html                 # App shell, UI, responsive and print styles
├── package.json               # Dev and production build commands
├── vite.config.js             # Vite + Cesium plugin configuration
├── public/
│   ├── assets/
│   │   ├── a320-family.glb    # Aircraft visual model
│   │   └── ATTRIBUTION.md     # Asset attribution and licence
│   └── models/
│       └── demo_flight.json   # Bundled PRC-style replay dataset
└── src/
    ├── main.js                # Globe, animation, report, charts, and UI wiring
    └── data/
        └── routes.js          # Adapts the bundled replay data for the UI
```
