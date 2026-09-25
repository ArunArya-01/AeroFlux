// AeroSim — AeroTwin model-validation simulator.
//
// Primary mode: loads a real PRC test flight with ground-truth fuel,
// OpenAP physics baseline, and R3 model predictions. Shows the achievement:
// R3 dramatically outperforms the physics baseline.

import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

import { loadDemoFlight } from './data/routes.js'

const SPEED_STEPS = [10, 50, 100, 250, 500, 1000, 2000]

const state = {
  viewer: null,
  speedIdx: 2,
  paused: false,
  cameraMode: 'overview',
  running: false,
  // Demo flight data.
  intervals: [],
  totalFuelKg: 0,
  totalDurationS: 0,
  // Chart data.
  chartActual: [],
  chartPhysics: [],
  chartR3: [],
  chartActualRate: [],
  chartPhysicsRate: [],
  chartR3Rate: [],
  chartMode: 'cumulative',
  completed: false,
  controlsAbort: null,
}

const els = {}
function grab() {
  ;[
    'hudOrigin', 'hudOriginName', 'hudDest', 'hudDestName',
    'hudAircraft', 'hudDistance', 'hudElapsed', 'hudFuelUsed',
    'hudFuelRemaining', 'hudEngine', 'hudProgress',
    'progressBarFill', 'btnPause', 'speedDown', 'speedUp', 'speedLabel',
    'thrustVal', 'thrustFill', 'dragVal', 'dragFill', 'liftVal', 'liftFill',
    'massTakeoff', 'massCurrent', 'massLanding', 'hudFuelRemaining', 'massFuelBurn',
    'massBurnRate', 'massFuelFrac', 'massRate', 'massWingLoad', 'massPhase',
    'predGt', 'predOpenap', 'predR3', 'predOpenapErr', 'predR3Err', 'predR3Rel', 'predChart',
    'timeline', 'liveRegion', 'completionModal', 'summaryFuel', 'summaryR3Error',
    'summaryPhysicsError', 'summaryImprovement', 'completionRoute',
  ].forEach((id) => (els[id] = document.getElementById(id)))
}

function fmtTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

async function main() {
  grab()
  const viewer = new Cesium.Viewer('cesiumContainer', {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    fullscreenButton: false,
  })
  state.viewer = viewer
  // Keep the globe legible even when Cesium's optional online imagery tiles
  // are unavailable (for example, in an offline demo environment).
  viewer.scene.globe.show = true
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#17324d')
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#06111f')
  viewer.scene.globe.enableLighting = true
  viewer.scene.globe.atmosphereLightFactor = 1.2
  viewer.scene.skyAtmosphere.show = true

  // Load demo flight.
  const flight = await loadDemoFlight()
  state.intervals = flight.intervals
  state.totalFuelKg = flight.intervals.reduce((a, iv) => a + iv.groundTruth, 0)
  state.totalDurationS = flight.intervals.reduce((a, iv) => a + iv.durationS, 0)

  els.hudOrigin.textContent = flight.origin
  els.hudOriginName.textContent = flight.originName
  els.hudDest.textContent = flight.destination
  els.hudDestName.textContent = flight.destinationName
  els.hudAircraft.textContent = flight.aircraftType
  els.hudDistance.textContent = `${(state.totalDurationS * 0.24 / 1000).toFixed(0)} km`
  els.hudEngine.textContent = 'PRC flight replay'
  els.completionRoute.textContent = `${flight.origin} → ${flight.destination}`

  bindControls(viewer)
  buildScene(viewer, flight)

  // Reset clock.
  const now = Cesium.JulianDate.fromDate(new Date())
  viewer.clock.startTime = now
  viewer.clock.stopTime = Cesium.JulianDate.addSeconds(now, state.totalDurationS, new Cesium.JulianDate())
  viewer.clock.currentTime = Cesium.JulianDate.clone(now)
  viewer.clock.shouldAnimate = !state.paused
  updateClock(viewer)
  state.running = true

  viewer.clock.onTick.addEventListener((clock) => tick(viewer, clock))
  viewer.clock.onTick.addEventListener((clock) => updateCamera(viewer, clock))
}

function buildScene(viewer, flight) {
  // Build a smooth great-circle path with realistic altitude profile.
  const startLat = 51.47, startLon = -0.45   // London Heathrow
  const endLat = 40.64, endLon = -73.78      // New York JFK
  const nSamples = 300

  // Great-circle interpolation (slerp on sphere).
  const latLonAlt = []
  const phi1 = Cesium.Math.toRadians(startLat)
  const lambda1 = Cesium.Math.toRadians(startLon)
  const phi2 = Cesium.Math.toRadians(endLat)
  const lambda2 = Cesium.Math.toRadians(endLon)
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((phi2 - phi1) / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin((lambda2 - lambda1) / 2) ** 2
  ))

  // Smooth easing functions for altitude transitions.
  const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  const easeOut = (t) => 1 - Math.pow(1 - t, 3)
  const easeIn = (t) => t * t * t

  for (let i = 0; i <= nSamples; i++) {
    const f = i / nSamples
    // Realistic altitude profile with smooth transitions.
    const cruiseAlt = 11000
    let alt
    if (f < 0.06) {
      // Takeoff: ground to 2000m with ease-out.
      alt = easeOut(f / 0.06) * 2000
    } else if (f < 0.15) {
      // Climb: 2000m to cruise with ease-in-out.
      alt = 2000 + easeInOut((f - 0.06) / 0.09) * (cruiseAlt - 2000)
    } else if (f > 0.90) {
      // Descent: cruise to 2000m with ease-in-out.
      const descFrac = (f - 0.90) / 0.08
      alt = 2000 + (1 - easeInOut(descFrac)) * (cruiseAlt - 2000)
    } else if (f > 0.97) {
      // Approach: 2000m to ground with ease-in.
      alt = (1 - easeIn((f - 0.97) / 0.03)) * 2000
    } else {
      // Cruise: gentle altitude variation.
      alt = cruiseAlt + Math.sin(f * Math.PI * 4) * 150 + Math.sin(f * Math.PI * 7) * 50
    }

    // Great-circle interpolation.
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(phi1) * Math.cos(lambda1) + B * Math.cos(phi2) * Math.cos(lambda2)
    const y = A * Math.cos(phi1) * Math.sin(lambda1) + B * Math.cos(phi2) * Math.sin(lambda2)
    const z = A * Math.sin(phi1) + B * Math.sin(phi2)
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y))
    const lon = Math.atan2(y, x)

    latLonAlt.push({
      lat: Cesium.Math.toDegrees(lat),
      lon: Cesium.Math.toDegrees(lon),
      alt: alt,
    })
  }

  // Sampled position property for smooth animation with auto-orientation.
  const positionProperty = new Cesium.SampledPositionProperty()
  const velocityOrientation = new Cesium.VelocityOrientationProperty(positionProperty)
  // The imported A320 sits 90° off Cesium's local forward axis. Correct only
  // its heading (around the local up axis): pitch and bank remain level.
  const a320ForwardCorrection = Cesium.Quaternion.fromAxisAngle(
    Cesium.Cartesian3.UNIT_Z,
    -Cesium.Math.PI_OVER_TWO,
  )
  const a320OrientationScratch = new Cesium.Quaternion()
  const a320Orientation = new Cesium.CallbackProperty((time, result) => {
    const routeOrientation = velocityOrientation.getValue(time)
    return routeOrientation
      ? Cesium.Quaternion.multiply(routeOrientation, a320ForwardCorrection, result || a320OrientationScratch)
      : undefined
  }, false)
  const startTime = viewer.clock.startTime
  const totalSeconds = state.totalDurationS

  for (let i = 0; i <= nSamples; i++) {
    const f = i / nSamples
    const time = Cesium.JulianDate.addSeconds(startTime, f * totalSeconds, new Cesium.JulianDate())
    const p = latLonAlt[i]
    positionProperty.addSample(time, Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt))
  }

  // One real A320-family 3D aircraft is used in every camera mode. The model's
  // velocity orientation makes its nose follow the route, while only the camera
  // angle changes between overview and follow mode.
  state.plane = viewer.entities.add({
    position: positionProperty,
    orientation: a320Orientation,
    model: {
      uri: '/assets/a320-family.glb',
      minimumPixelSize: new Cesium.CallbackProperty(
        () => (state.cameraMode === 'follow' ? 96 : 52),
        false,
      ),
      maximumScale: 1800,
      runAnimations: true,
    },
    // Cesium's native path renderer produces a single continuous historical
    // trail, revealing only where the aircraft has already been.
    path: {
      leadTime: 0,
      trailTime: totalSeconds,
      resolution: 30,
      width: 2,
      material: Cesium.Color.fromCssColorString('#edf6ff').withAlpha(0.88),
    },
  })

  // Origin / destination markers.
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(startLon, startLat, 0),
    point: { pixelSize: 8, color: Cesium.Color.WHITE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: 'LHR', font: 'bold 12px sans-serif', fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, outlineColor: Cesium.Color.BLACK, disableDepthTestDistance: Number.POSITIVE_INFINITY, pixelOffset: new Cesium.Cartesian2(0, 14) },
  })
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(endLon, endLat, 0),
    point: { pixelSize: 8, color: Cesium.Color.WHITE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: 'JFK', font: 'bold 12px sans-serif', fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, outlineColor: Cesium.Color.BLACK, disableDepthTestDistance: Number.POSITIVE_INFINITY, pixelOffset: new Cesium.Cartesian2(0, 14) },
  })

  setOverviewCamera(viewer, 0)
}

function setOverviewCamera(viewer, duration = 0.65) {
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  viewer.camera.flyTo({
    // A wide, overhead North Atlantic framing that keeps both LHR and JFK in view.
    destination: Cesium.Cartesian3.fromDegrees(-37, 47, 6500000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
    duration,
  })
}

function updateCamera(viewer, clock) {
  const pos = state.plane.position.getValue(clock.currentTime)
  if (!pos || state.cameraMode !== 'follow') return
  viewer.camera.lookAt(pos, new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(120),
    Cesium.Math.toRadians(-8),
    12000,
  ))
}

function updateClock(viewer) {
  viewer.clock.multiplier = SPEED_STEPS[state.speedIdx]
  els.speedLabel.textContent = String(SPEED_STEPS[state.speedIdx])
}

function bindControls(viewer) {
  // A new Cesium viewer is created after returning Home. Remove the prior
  // viewer's UI listeners first so each control always responds exactly once.
  state.controlsAbort?.abort()
  state.controlsAbort = new AbortController()
  const listenerOptions = { signal: state.controlsAbort.signal }

  els.btnPause.addEventListener('click', () => {
    state.paused = !state.paused
    viewer.clock.shouldAnimate = !state.paused
    els.btnPause.textContent = state.paused ? '▶' : '⏸'
    els.btnPause.classList.toggle('active', !state.paused)
  }, listenerOptions)
  els.speedUp.addEventListener('click', () => { state.speedIdx = Math.min(SPEED_STEPS.length - 1, state.speedIdx + 1); updateClock(viewer) }, listenerOptions)
  els.speedDown.addEventListener('click', () => { state.speedIdx = Math.max(0, state.speedIdx - 1); updateClock(viewer) }, listenerOptions)
  document.querySelectorAll('#cameraMode .cn-btn').forEach((btn) => {
    if (!btn.dataset.cam) return
    btn.addEventListener('click', () => {
      state.cameraMode = btn.dataset.cam
      document.querySelectorAll('#cameraMode .cn-btn').forEach((b) => b.classList.toggle('active', b === btn))
      if (state.cameraMode === 'overview') setOverviewCamera(viewer)
      else updateCamera(viewer, viewer.clock)
    }, listenerOptions)
  })
  document.getElementById('btnFocus').addEventListener('click', (event) => {
    const focused = document.body.classList.toggle('focus-mode')
    event.currentTarget.classList.toggle('active', focused)
    event.currentTarget.textContent = focused ? 'Exit focus' : 'Focus'
  }, listenerOptions)
  document.getElementById('btnTheme').addEventListener('click', (event) => {
    const light = document.body.classList.toggle('light-theme')
    event.currentTarget.classList.toggle('active', light)
    event.currentTarget.textContent = light ? 'Dark' : 'Theme'
  }, listenerOptions)
  document.querySelectorAll('[data-collapse]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.panel-card')
      const collapsed = card.classList.toggle('collapsed')
      button.textContent = collapsed ? '+' : '−'
    }, listenerOptions)
  })
  document.querySelectorAll('[data-chart-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.chartMode = button.dataset.chartMode
      document.querySelectorAll('[data-chart-mode]').forEach((item) => item.classList.toggle('active', item === button))
      drawChart()
    }, listenerOptions)
  })
  els.timeline.addEventListener('input', () => {
    const fraction = Number(els.timeline.value) / Number(els.timeline.max)
    viewer.clock.currentTime = Cesium.JulianDate.addSeconds(viewer.clock.startTime, fraction * state.totalDurationS, new Cesium.JulianDate())
    tick(viewer, viewer.clock)
  }, listenerOptions)
  document.getElementById('libraryBtn').addEventListener('click', () => toggleLibrary(true), listenerOptions)
  document.getElementById('libraryClose').addEventListener('click', () => toggleLibrary(false), listenerOptions)
  document.getElementById('summaryClose').addEventListener('click', () => hideCompletion(), listenerOptions)
  document.getElementById('replayBtn').addEventListener('click', () => replay(viewer), listenerOptions)
}

function tick(viewer, clock) {
  if (!state.running) return
  const t = Math.max(0, Math.min(1, Cesium.JulianDate.secondsDifference(clock.currentTime, clock.startTime) / state.totalDurationS))
  const ints = state.intervals
  const fp = t * (ints.length - 1)
  const idx = Math.min(ints.length - 1, Math.floor(fp))
  const frac = fp - Math.floor(fp)
  const iv = ints[idx]

  // Cumulative fuel up to current interval.
  let cumGt = 0, cumPhys = 0, cumR3 = 0
  for (let i = 0; i < idx; i++) {
    cumGt += ints[i].groundTruth
    cumPhys += ints[i].physicsFuelKg
    cumR3 += ints[i].r3Prediction
  }
  cumGt += iv.groundTruth * frac
  cumPhys += iv.physicsFuelKg * frac
  cumR3 += iv.r3Prediction * frac

  const elapsed = t * state.totalDurationS

  els.hudProgress.textContent = `${(t * 100).toFixed(1)}%`
  els.progressBarFill.style.width = `${t * 100}%`
  els.timeline.value = String(Math.round(t * Number(els.timeline.max)))
  els.hudElapsed.textContent = fmtTime(elapsed)
  els.hudFuelUsed.textContent = `${cumGt.toFixed(0)} kg`
  els.hudFuelRemaining.textContent = `${Math.max(0, state.totalFuelKg - cumGt).toFixed(0)} kg`

  // Force meters from flight state.
  updateForceMeters(iv)
  updateMassPanel(iv, cumGt)
  updatePhaseIndicator(iv, t)

  // Prediction comparison.
  updatePredictionComparison(iv, idx, cumGt, cumPhys, cumR3)
  if (t >= 0.999 && !state.completed) showCompletion(cumGt, cumPhys, cumR3)
}

function updatePhaseIndicator(iv, progress) {
  let phase = iv.phase && iv.phase !== 'unknown' ? iv.phase.toLowerCase() : ''
  if (!phase) phase = progress < 0.04 ? 'takeoff' : progress < 0.15 ? 'climb' : progress < 0.9 ? 'cruise' : progress < 0.98 ? 'descent' : 'landing'
  document.querySelectorAll('[data-phase-step]').forEach((step) => step.classList.toggle('active', step.dataset.phaseStep === phase))
}

function updateForceMeters(iv) {
  if (!iv) return
  const speedMs = iv.groundSpeedMps || 240
  const altM = iv.altitudeM || 10000
  const vRate = iv.verticalRateMps || 0
  const densityRatio = Math.exp(-altM / 8500)
  const climbFactor = 0.45 + 0.55 * Math.max(0, Math.min(1, 0.5 + vRate / 12))
  const thrust = Math.round(Math.min(100, climbFactor * 100))
  const dragRaw = densityRatio * Math.pow(speedMs / 240, 2)
  const drag = Math.round(Math.min(100, Math.max(8, dragRaw * 90 + 10)))
  const liftFactor = 0.5 + 0.5 * Math.max(0, Math.min(1, 0.5 + vRate / 15))
  const lift = Math.round(Math.min(100, liftFactor * 100))
  els.thrustVal.textContent = `${thrust}%`
  els.thrustFill.style.width = `${thrust}%`
  els.dragVal.textContent = `${drag}%`
  els.dragFill.style.width = `${drag}%`
  els.liftVal.textContent = `${lift}%`
  els.liftFill.style.width = `${lift}%`
  return thrust
}

function updateMassPanel(iv, cumGt) {
  if (!iv) return
  const oew = 42600
  const takeoff = oew + 15000 + state.totalFuelKg
  const current = takeoff - cumGt
  const landing = oew + 15000 + state.totalFuelKg * 0.08
  const remaining = state.totalFuelKg - cumGt
  const burnRate = iv.groundTruth / Math.max(iv.durationS, 1)
  const vRate = iv.verticalRateMps || 0
  let phase = iv.phase && iv.phase !== 'unknown' ? iv.phase : 'Cruise'
  if (vRate > 1.5) phase = 'Climb'
  else if (vRate < -1.5) phase = 'Descent'
  els.massTakeoff.textContent = `${(takeoff / 1000).toFixed(1)} t`
  els.massCurrent.textContent = `${(current / 1000).toFixed(1)} t`
  els.massLanding.textContent = `${(landing / 1000).toFixed(1)} t`
  els.hudFuelRemaining.textContent = `${remaining.toFixed(0)} kg`
  els.massFuelBurn.textContent = `${cumGt.toFixed(0)} kg`
  els.massBurnRate.textContent = `${burnRate.toFixed(2)} kg/s`
  els.massFuelFrac.textContent = `${((remaining / takeoff) * 100).toFixed(1)}%`
  els.massRate.textContent = `${(-burnRate).toFixed(2)} kg/s`
  els.massWingLoad.textContent = `${(current / 122.6).toFixed(0)} kg/m²`
  els.massPhase.textContent = phase.charAt(0).toUpperCase() + phase.slice(1)
}

function updatePredictionComparison(iv, idx, cumGt, cumPhys, cumR3) {
  if (!iv) return
  const gt = iv.groundTruth
  const phys = iv.physicsFuelKg
  const r3 = iv.r3Prediction
  const physErr = phys - gt
  const r3Err = r3 - gt
  const r3RelErr = gt > 0 ? (Math.abs(r3Err) / gt) * 100 : 0

  els.predGt.textContent = `${gt.toFixed(0)} kg`
  els.predOpenap.textContent = `${phys.toFixed(0)} kg`
  els.predR3.textContent = `${r3.toFixed(0)} kg`
  els.predOpenapErr.textContent = `${physErr >= 0 ? '+' : ''}${physErr.toFixed(0)} kg`
  els.predR3Err.textContent = `${r3Err >= 0 ? '+' : ''}${r3Err.toFixed(0)} kg`
  els.predR3Rel.textContent = `${r3RelErr.toFixed(1)}%`

  // Chart data (sample every few intervals).
  if (state.chartActual.length <= idx) {
    state.chartActual.push(cumGt)
    state.chartPhysics.push(cumPhys)
    state.chartR3.push(cumR3)
    state.chartActualRate.push(gt / Math.max(iv.durationS, 1))
    state.chartPhysicsRate.push(phys / Math.max(iv.durationS, 1))
    state.chartR3Rate.push(r3 / Math.max(iv.durationS, 1))
    drawChart()
  }
}

function drawChart() {
  const canvas = els.predChart
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  const actual = state.chartMode === 'rate' ? state.chartActualRate : state.chartActual
  const phys = state.chartMode === 'rate' ? state.chartPhysicsRate : state.chartPhysics
  const r3 = state.chartMode === 'rate' ? state.chartR3Rate : state.chartR3
  if (actual.length === 0) return

  const maxVal = Math.max(...actual, ...phys, ...r3, 1)

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  for (let line = 1; line < 4; line++) {
    const y = (H / 4) * line
    ctx.beginPath()
    ctx.moveTo(4, y)
    ctx.lineTo(W - 4, y)
    ctx.stroke()
  }

  // OpenAP (white, dashed).
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  phys.forEach((v, i) => {
    const x = (i / Math.max(1, phys.length - 1)) * (W - 8) + 4
    const y = H - 6 - (v / maxVal) * (H - 12)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // Ground truth (white, solid).
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.setLineDash([])
  ctx.beginPath()
  actual.forEach((v, i) => {
    const x = (i / Math.max(1, actual.length - 1)) * (W - 8) + 4
    const y = H - 6 - (v / maxVal) * (H - 12)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // R3 (red).
  ctx.strokeStyle = '#dc1414'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  r3.forEach((v, i) => {
    const x = (i / Math.max(1, r3.length - 1)) * (W - 8) + 4
    const y = H - 6 - (v / maxVal) * (H - 12)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
}

function toggleLibrary(open) {
  const drawer = document.getElementById('flightLibrary')
  drawer.classList.toggle('open', open)
  drawer.setAttribute('aria-hidden', String(!open))
}

function showCompletion(fuel, physics, r3) {
  state.completed = true
  state.paused = true
  state.viewer.clock.shouldAnimate = false
  els.btnPause.textContent = '▶'
  const physicsError = physics - fuel
  const r3Error = r3 - fuel
  const improvement = Math.abs(physicsError) > 0 ? (1 - Math.abs(r3Error) / Math.abs(physicsError)) * 100 : 0
  els.summaryFuel.textContent = `${fuel.toFixed(0)} kg`
  els.summaryR3Error.textContent = `${r3Error >= 0 ? '+' : ''}${r3Error.toFixed(0)} kg`
  els.summaryPhysicsError.textContent = `${physicsError >= 0 ? '+' : ''}${physicsError.toFixed(0)} kg`
  els.summaryImprovement.textContent = `${improvement.toFixed(1)}% lower error`
  els.completionModal.classList.add('open')
  els.completionModal.setAttribute('aria-hidden', 'false')
  els.liveRegion.textContent = 'Flight complete. Simulation summary is open.'
}

function hideCompletion() {
  els.completionModal.classList.remove('open')
  els.completionModal.setAttribute('aria-hidden', 'true')
}

function replay(viewer) {
  state.chartActual = []
  state.chartPhysics = []
  state.chartR3 = []
  state.chartActualRate = []
  state.chartPhysicsRate = []
  state.chartR3Rate = []
  state.completed = false
  state.paused = false
  viewer.clock.currentTime = Cesium.JulianDate.clone(viewer.clock.startTime)
  viewer.clock.shouldAnimate = true
  els.btnPause.textContent = '⏸'
  hideCompletion()
  drawChart()
  els.liveRegion.textContent = 'Flight replay restarted.'
}

async function launch() {
  const home = document.getElementById('homeOverlay')
  const simUI = document.getElementById('simUI')
  home.classList.add('hidden')
  simUI.classList.add('ready')
  await new Promise((r) => requestAnimationFrame(() => r()))
  await main()
}

document.getElementById('launchBtn').addEventListener('click', () => {
  launch().catch((err) => {
    console.error(err)
    const e = document.getElementById('hudEngine')
    if (e) e.textContent = 'Error: ' + err.message
  })
})

const researchModal = document.getElementById('researchModal')
const setResearchOpen = (open) => {
  researchModal.classList.toggle('open', open)
  researchModal.setAttribute('aria-hidden', String(!open))
  if (open) document.getElementById('researchClose').focus()
  else document.getElementById('researchBtn').focus()
}
document.getElementById('researchBtn').addEventListener('click', () => setResearchOpen(true))
document.getElementById('researchClose').addEventListener('click', () => setResearchOpen(false))
researchModal.addEventListener('click', (event) => {
  if (event.target === researchModal) setResearchOpen(false)
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && researchModal.classList.contains('open')) setResearchOpen(false)
})

// Back button: stop the viewer and return to home.
document.getElementById('backBtn').addEventListener('click', () => {
  // Stop the clock and destroy the viewer to free WebGL resources.
  if (state.viewer) {
    state.viewer.clock.shouldAnimate = false
    state.viewer.destroy()
    state.viewer = null
  }
  state.running = false
  // Show home overlay, hide sim UI.
  document.getElementById('homeOverlay').classList.remove('hidden')
  document.getElementById('simUI').classList.remove('ready')
})

if (new URLSearchParams(location.search).get('autolaunch') === '1') {
  document.getElementById('launchBtn')?.click()
}
