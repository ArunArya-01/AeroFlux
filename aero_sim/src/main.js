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
  chartLayout: 'overlay',
  completed: false,
  controlsAbort: null,
  metricTooltipBound: false,
  mobilePanel: null,
  routeSamples: [],
  miniMapDragBound: false,
  heatmapMode: 'burn',
  heatmapSegments: [],
  weatherEnabled: false,
  weatherEntities: [],
  aircraftHoverActive: false,
  reportExport: null,
  printing: false,
  phaseAnchors: { takeoff: 0, climb: 0.06, cruise: 0.15, descent: 0.9, landing: 0.98 },
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
    'predGt', 'predOpenap', 'predR3', 'predOpenapErr', 'predR3Err', 'predR3Rel', 'predImprovement', 'predChart', 'predChartExpanded',
    'timeline', 'liveRegion', 'completionModal', 'summaryFuel', 'summaryR3Error',
    'summaryPhysicsError', 'summaryImprovement', 'completionRoute',
    'aircraftHoverCard', 'aircraftHoverAltitude', 'aircraftHoverSpeed',
    'aircraftHoverHeading', 'aircraftHoverEta', 'comparisonModal', 'metricTooltip',
    'miniMap', 'miniMapCanvas',
    'weatherReadout', 'weatherWind', 'weatherTemp', 'weatherCloud', 'weatherTurbulence',
    'commandPalette', 'commandSearch', 'commandList', 'commandEmpty',
    'benchmarkModal',
    'flightReportModal', 'reportRoute', 'reportDuration', 'reportFuel', 'reportR3Error',
    'reportImprovement', 'reportMeasured', 'reportPhysics', 'reportPhysicsError',
    'reportR3', 'reportR3AbsError', 'reportChart', 'reportTakeoffMass', 'reportFinalMass',
    'reportFuelRemaining', 'reportWingLoading', 'reportPhase', 'reportBurnRate',
    'reportThrust', 'reportDragLift', 'reportIntervalChart', 'reportErrorChart',
    'reportPhysicsTotal', 'reportR3Total', 'reportPhysicsFinalAbs', 'reportR3FinalAbs',
    'reportPhysicsRelative', 'reportR3Relative', 'reportPhysicsMae', 'reportR3Mae',
    'reportPhysicsWorst', 'reportR3Worst',
    'reportEvents', 'reportPhaseSummary', 'reportPeakAltitude', 'reportPeakSpeed',
    'reportPeakBurn', 'reportPeakError',
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
  bindMetricTooltips()
  bindMiniMapDrag()
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
  bindAircraftHover(viewer)

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

function bindMetricTooltips() {
  if (state.metricTooltipBound) return
  state.metricTooltipBound = true

  let activeTip = null
  const hide = () => {
    activeTip = null
    els.metricTooltip.classList.remove('visible')
    els.metricTooltip.setAttribute('aria-hidden', 'true')
  }
  const show = (tip) => {
    const message = tip.dataset.tip
    if (!message) return hide()

    activeTip = tip
    els.metricTooltip.textContent = message
    const rect = tip.getBoundingClientRect()
    const maxLeft = Math.max(12, window.innerWidth - 262)
    els.metricTooltip.style.left = `${Math.min(Math.max(12, rect.left), maxLeft)}px`

    // Put the card above the icon where possible, otherwise below it. Because
    // this element is fixed at the app root, right-rail scrolling cannot crop it.
    const showBelow = rect.top < 110
    els.metricTooltip.style.top = `${showBelow ? rect.bottom + 8 : rect.top - 8}px`
    els.metricTooltip.style.transform = showBelow ? 'none' : 'translateY(-100%)'
    els.metricTooltip.classList.add('visible')
    els.metricTooltip.setAttribute('aria-hidden', 'false')
  }

  document.addEventListener('pointerover', (event) => {
    const tip = event.target.closest('.help-tip')
    if (tip) show(tip)
  })
  document.addEventListener('pointerout', (event) => {
    const tip = event.target.closest('.help-tip')
    if (tip && activeTip === tip) hide()
  })
  document.addEventListener('focusin', (event) => {
    const tip = event.target.closest('.help-tip')
    if (tip) show(tip)
  })
  document.addEventListener('focusout', (event) => {
    const tip = event.target.closest('.help-tip')
    if (tip && activeTip === tip) hide()
  })
  window.addEventListener('resize', hide)
  window.addEventListener('scroll', hide, true)
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
  state.routeSamples = latLonAlt

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
  const cartesianSamples = []

  for (let i = 0; i <= nSamples; i++) {
    const f = i / nSamples
    const time = Cesium.JulianDate.addSeconds(startTime, f * totalSeconds, new Cesium.JulianDate())
    const p = latLonAlt[i]
    const position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt)
    positionProperty.addSample(time, position)
    cartesianSamples.push(position)
  }
  buildRouteHeatmap(viewer, cartesianSamples, startTime, totalSeconds)
  buildWeatherDemo(viewer)

  // One real A320-family 3D aircraft is used in every camera mode. The model's
  // velocity orientation makes its nose follow the route, while only the camera
  // angle changes between overview and follow mode.
  state.plane = viewer.entities.add({
    position: positionProperty,
    orientation: a320Orientation,
    label: {
      text: new Cesium.CallbackProperty((time) => {
        const progress = Math.max(0, Math.min(1, Cesium.JulianDate.secondsDifference(time, startTime) / totalSeconds))
        const intervalIndex = Math.min(state.intervals.length - 1, Math.floor(progress * (state.intervals.length - 1)))
        return getFlightPhase(state.intervals[intervalIndex], progress).toUpperCase()
      }, false),
      font: '700 12px system-ui',
      fillColor: Cesium.Color.WHITE,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineColor: Cesium.Color.fromCssColorString('#08121f'),
      outlineWidth: 3,
      pixelOffset: new Cesium.Cartesian2(0, -54),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
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

function buildRouteHeatmap(viewer, positions, startTime, totalSeconds) {
  state.heatmapSegments = []
  const segmentCount = positions.length - 1
  for (let index = 0; index < segmentCount; index++) {
    const endFraction = (index + 1) / segmentCount
    const entity = viewer.entities.add({
      polyline: {
        positions: [positions[index], positions[index + 1]],
        width: 5,
        material: Cesium.Color.WHITE,
        show: new Cesium.CallbackProperty((time) => (
          Cesium.JulianDate.secondsDifference(time, startTime) / totalSeconds >= endFraction
        ), false),
      },
    })
    state.heatmapSegments.push({ entity, index })
  }
  updateRouteHeatmap()
}

function updateRouteHeatmap() {
  if (!state.heatmapSegments.length) return
  const values = state.heatmapSegments.map(({ index }) => {
    const interval = state.intervals[Math.min(state.intervals.length - 1, Math.floor(index / state.heatmapSegments.length * state.intervals.length))]
    if (state.heatmapMode === 'altitude') return state.routeSamples[index]?.alt || 0
    if (state.heatmapMode === 'error') return Math.abs(interval.r3Prediction - interval.groundTruth)
    return interval.groundTruth / Math.max(interval.durationS, 1)
  })
  const minimum = Math.min(...values)
  const span = Math.max(0.0001, Math.max(...values) - minimum)
  state.heatmapSegments.forEach(({ entity, index }) => {
    const normalized = (values[index] - minimum) / span
    // Cool colours mean low value; warm colours mean high value.
    entity.polyline.material = Cesium.Color.fromHsl(0.62 - normalized * 0.62, 0.86, 0.54, 0.96)
  })
}

function buildWeatherDemo(viewer) {
  const windArrows = [
    [[-65, 45], [-59, 47]], [[-53, 49], [-47, 51]], [[-41, 52], [-35, 53]],
    [[-29, 53], [-23, 52]], [[-17, 51], [-11, 49]],
  ]
  windArrows.forEach(([from, to]) => {
    state.weatherEntities.push(viewer.entities.add({
      show: false,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([from[0], from[1], 14000, to[0], to[1], 14000]),
        width: 3,
        material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.fromCssColorString('#75d9ff').withAlpha(0.72)),
      },
    }))
  })
  ;[[-56, 48], [-39, 51], [-22, 50]].forEach(([lon, lat], index) => {
    state.weatherEntities.push(viewer.entities.add({
      show: false,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 5000 + index * 900),
      ellipse: {
        semiMajorAxis: 210000,
        semiMinorAxis: 95000,
        material: Cesium.Color.WHITE.withAlpha(0.14),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#c9f0ff').withAlpha(0.16),
      },
    }))
  })
}

function setWeatherEnabled(enabled) {
  state.weatherEnabled = enabled
  state.weatherEntities.forEach((entity) => { entity.show = enabled })
  els.weatherReadout.classList.toggle('visible', enabled)
  els.weatherReadout.setAttribute('aria-hidden', String(!enabled))
  const button = document.getElementById('weatherToggle')
  button.classList.toggle('active', enabled)
  button.setAttribute('aria-pressed', String(enabled))
  button.textContent = enabled ? 'Weather on' : 'Weather'
}

function updateWeatherReadout(interval, progress) {
  if (!state.weatherEnabled || !interval) return
  const altitudeKm = (interval.altitudeM || 0) / 1000
  const windSpeed = 34 + Math.round(22 * (0.5 + 0.5 * Math.sin(progress * Math.PI * 3)))
  const windHeading = ['W', 'WNW', 'NW', 'WSW'][Math.floor(progress * 4) % 4]
  const cloud = Math.round(25 + 55 * (0.5 + 0.5 * Math.cos(progress * Math.PI * 4)))
  const turbulence = cloud > 62 ? 'Moderate' : cloud > 43 ? 'Light' : 'Smooth'
  els.weatherWind.textContent = `${windHeading} ${windSpeed} kt`
  els.weatherTemp.textContent = `${(15 - altitudeKm * 6.5).toFixed(0)}°C`
  els.weatherCloud.textContent = `${cloud}%`
  els.weatherTurbulence.textContent = turbulence
}

function bindAircraftHover(viewer) {
  viewer.screenSpaceEventHandler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.endPosition)
    if (!picked || picked.id !== state.plane) {
      hideAircraftHover(viewer)
      return
    }
    state.aircraftHoverActive = true
    updateAircraftHover(viewer)
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
}

function hideAircraftHover(viewer) {
  state.aircraftHoverActive = false
  els.aircraftHoverCard.classList.remove('visible')
  els.aircraftHoverCard.setAttribute('aria-hidden', 'true')
  viewer.canvas.style.cursor = 'default'
}

function updateAircraftHover(viewer) {
  if (!state.aircraftHoverActive) return
  const position = state.plane.position.getValue(viewer.clock.currentTime)
  const screen = position && Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position)
  if (!screen) return hideAircraftHover(viewer)

  const t = Math.max(0, Math.min(1, Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, viewer.clock.startTime) / state.totalDurationS))
  const intervalIndex = Math.min(state.intervals.length - 1, Math.floor(t * (state.intervals.length - 1)))
  const interval = state.intervals[intervalIndex]
  const cartographic = Cesium.Cartographic.fromCartesian(position)
  const futureTime = Cesium.JulianDate.addSeconds(viewer.clock.currentTime, 30, new Cesium.JulianDate())
  const future = state.plane.position.getValue(futureTime)

  let headingDegrees = 0
  if (future) {
    const geodesic = new Cesium.EllipsoidGeodesic(cartographic, Cesium.Cartographic.fromCartesian(future))
    headingDegrees = (Cesium.Math.toDegrees(geodesic.startHeading) + 360) % 360
  }
  const compass = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(headingDegrees / 22.5) % 16]
  const remaining = Math.max(0, state.totalDurationS * (1 - t))

  els.aircraftHoverAltitude.textContent = `${(cartographic.height / 1000).toFixed(1)} km`
  els.aircraftHoverSpeed.textContent = `${Math.round((interval.groundSpeedMps || 0) * 1.94384)} kt`
  els.aircraftHoverHeading.textContent = `${String(Math.round(headingDegrees)).padStart(3, '0')}° ${compass}`
  els.aircraftHoverEta.textContent = fmtTime(remaining)
  els.aircraftHoverCard.style.left = `${screen.x}px`
  els.aircraftHoverCard.style.top = `${screen.y}px`
  els.aircraftHoverCard.classList.add('visible')
  els.aircraftHoverCard.setAttribute('aria-hidden', 'false')
  viewer.canvas.style.cursor = 'pointer'
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

function updateMiniMap(progress) {
  const visible = state.cameraMode === 'follow' && state.routeSamples.length > 0
  els.miniMap.classList.toggle('visible', visible)
  els.miniMap.setAttribute('aria-hidden', String(!visible))
  if (!visible) return

  const canvas = els.miniMapCanvas
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  const pad = 48
  const bounds = { west: -80, east: 2, south: 34, north: 60 }
  const project = ({ lon, lat }) => ({
    x: pad + ((lon - bounds.west) / (bounds.east - bounds.west)) * (W - pad * 2),
    y: H - pad - ((lat - bounds.south) / (bounds.north - bounds.south)) * (H - pad * 2),
  })
  const samples = state.routeSamples
  const currentIndex = Math.min(samples.length - 1, Math.round(progress * (samples.length - 1)))

  ctx.fillStyle = '#091a2b'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(133,188,216,.12)'
  ctx.lineWidth = 1
  for (let lon = -70; lon <= 0; lon += 20) {
    const x = project({ lon, lat: bounds.south }).x
    ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, H - pad); ctx.stroke()
  }
  for (let lat = 40; lat < 60; lat += 10) {
    const y = project({ lon: bounds.west, lat }).y
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke()
  }
  const trace = (endIndex, color, width) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    samples.slice(0, endIndex + 1).forEach((sample, index) => {
      const point = project(sample)
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.stroke()
  }
  trace(samples.length - 1, 'rgba(255,255,255,.24)', 2)
  trace(currentIndex, '#edf6ff', 3)

  const origin = project(samples[0])
  const destination = project(samples[samples.length - 1])
  const aircraft = project(samples[currentIndex])
  ;[[origin, 'LHR'], [destination, 'JFK']].forEach(([point, label]) => {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,.82)'
    ctx.font = '700 15px system-ui'
    ctx.fillText(label, point.x + 7, point.y - 7)
  })
  ctx.fillStyle = '#ed1c24'
  ctx.beginPath(); ctx.arc(aircraft.x, aircraft.y, 7, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.stroke()
}

function bindMiniMapDrag() {
  if (state.miniMapDragBound) return
  state.miniMapDragBound = true
  const map = els.miniMap
  let drag = null

  map.addEventListener('pointerdown', (event) => {
    if (state.cameraMode !== 'follow') return
    const rect = map.getBoundingClientRect()
    drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
    map.setPointerCapture(event.pointerId)
    map.classList.add('dragging')
    event.preventDefault()
  })
  map.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const rect = map.getBoundingClientRect()
    const left = Math.min(Math.max(8, event.clientX - drag.offsetX), window.innerWidth - rect.width - 8)
    const top = Math.min(Math.max(8, event.clientY - drag.offsetY), window.innerHeight - rect.height - 8)
    map.style.left = `${left}px`
    map.style.top = `${top}px`
    map.style.right = 'auto'
    map.style.bottom = 'auto'
  })
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    drag = null
    map.classList.remove('dragging')
    if (map.hasPointerCapture(event.pointerId)) map.releasePointerCapture(event.pointerId)
  }
  map.addEventListener('pointerup', endDrag)
  map.addEventListener('pointercancel', endDrag)
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
      setCameraMode(viewer, btn.dataset.cam)
    }, listenerOptions)
  })
  document.getElementById('btnFocus').addEventListener('click', (event) => {
    toggleFocusMode(event.currentTarget)
  }, listenerOptions)
  document.getElementById('btnTheme').addEventListener('click', (event) => {
    const light = document.body.classList.toggle('light-theme')
    event.currentTarget.classList.toggle('active', light)
    event.currentTarget.textContent = light ? 'Dark' : 'Theme'
  }, listenerOptions)
  document.querySelectorAll('[data-phase-step]').forEach((button) => {
    button.addEventListener('click', () => jumpToPhase(viewer, button.dataset.phaseStep), listenerOptions)
  })
  document.querySelectorAll('[data-collapse]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.panel-card')
      const collapsed = card.classList.toggle('collapsed')
      button.textContent = collapsed ? '+' : '−'
    }, listenerOptions)
  })
  document.querySelectorAll('[data-mobile-panel]').forEach((button) => {
    button.addEventListener('click', () => setMobilePanel(button.dataset.mobilePanel), listenerOptions)
  })
  document.querySelectorAll('[data-heatmap-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.heatmapMode = button.dataset.heatmapMode
      document.querySelectorAll('[data-heatmap-mode]').forEach((item) => item.classList.toggle('active', item === button))
      updateRouteHeatmap()
      els.liveRegion.textContent = `Travelled route coloured by ${button.textContent.toLowerCase()}.`
    }, listenerOptions)
  })
  document.getElementById('weatherToggle').addEventListener('click', () => {
    setWeatherEnabled(!state.weatherEnabled)
    els.liveRegion.textContent = state.weatherEnabled ? 'Demo weather layer enabled.' : 'Demo weather layer disabled.'
  }, listenerOptions)
  document.getElementById('commandPaletteBtn').addEventListener('click', () => setCommandPaletteOpen(true), listenerOptions)
  els.commandSearch.addEventListener('input', () => filterCommandPalette(), listenerOptions)
  els.commandList.addEventListener('click', (event) => {
    const action = event.target.closest('[data-command]')
    if (action) runCommand(viewer, action.dataset.command)
  }, listenerOptions)
  document.querySelectorAll('[data-chart-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.chartMode = button.dataset.chartMode
      document.querySelectorAll('[data-chart-mode]').forEach((item) => item.classList.toggle('active', item === button))
      drawChart()
    }, listenerOptions)
  })
  document.querySelectorAll('[data-chart-layout]').forEach((button) => {
    button.addEventListener('click', () => {
      state.chartLayout = button.dataset.chartLayout
      document.querySelectorAll('[data-chart-layout]').forEach((item) => item.classList.toggle('active', item === button))
      drawChart()
    }, listenerOptions)
  })
  document.getElementById('expandComparisonBtn').addEventListener('click', () => setComparisonOpen(true), listenerOptions)
  document.getElementById('comparisonClose').addEventListener('click', () => setComparisonOpen(false), listenerOptions)
  document.getElementById('benchmarkOpen').addEventListener('click', () => setBenchmarkOpen(true), listenerOptions)
  document.getElementById('benchmarkClose').addEventListener('click', () => setBenchmarkOpen(false), listenerOptions)
  els.comparisonModal.addEventListener('click', (event) => {
    if (event.target === els.comparisonModal) setComparisonOpen(false)
  }, listenerOptions)
  els.benchmarkModal.addEventListener('click', (event) => {
    if (event.target === els.benchmarkModal) setBenchmarkOpen(false)
  }, listenerOptions)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.comparisonModal.classList.contains('open')) setComparisonOpen(false)
    if (event.key === 'Escape' && els.benchmarkModal.classList.contains('open')) setBenchmarkOpen(false)
    if (event.key === 'Escape' && els.flightReportModal.classList.contains('open')) setFlightReportOpen(false)
    if (event.key === 'Escape' && els.commandPalette.classList.contains('open')) setCommandPaletteOpen(false)
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      setCommandPaletteOpen(true)
    }
  }, listenerOptions)
  els.timeline.addEventListener('input', () => {
    const fraction = Number(els.timeline.value) / Number(els.timeline.max)
    viewer.clock.currentTime = Cesium.JulianDate.addSeconds(viewer.clock.startTime, fraction * state.totalDurationS, new Cesium.JulianDate())
    tick(viewer, viewer.clock)
  }, listenerOptions)
  document.getElementById('libraryBtn').addEventListener('click', () => toggleLibrary(true), listenerOptions)
  document.getElementById('libraryClose').addEventListener('click', () => toggleLibrary(false), listenerOptions)
  document.getElementById('summaryClose').addEventListener('click', () => hideCompletion(), listenerOptions)
  document.getElementById('openReportBtn').addEventListener('click', () => {
    hideCompletion()
    setFlightReportOpen(true)
  }, listenerOptions)
  document.getElementById('replayBtn').addEventListener('click', () => replay(viewer), listenerOptions)
  document.getElementById('reportClose').addEventListener('click', () => setFlightReportOpen(false), listenerOptions)
  document.getElementById('reportPrint').addEventListener('click', () => prepareReportPrint(), listenerOptions)
  document.getElementById('reportExportCsv').addEventListener('click', () => exportFlightReport('csv'), listenerOptions)
  document.getElementById('reportExportJson').addEventListener('click', () => exportFlightReport('json'), listenerOptions)
  els.flightReportModal.addEventListener('click', (event) => {
    if (event.target === els.flightReportModal) setFlightReportOpen(false)
  }, listenerOptions)
  window.addEventListener('beforeprint', () => {
    state.printing = true
    drawChart()
  }, listenerOptions)
  window.addEventListener('afterprint', () => {
    state.printing = false
    drawChart()
  }, listenerOptions)
}

function setMobilePanel(panel) {
  state.mobilePanel = state.mobilePanel === panel ? null : panel
  document.body.classList.toggle('mobile-panel-flight', state.mobilePanel === 'flight')
  document.body.classList.toggle('mobile-panel-data', state.mobilePanel === 'data')
  document.querySelectorAll('[data-mobile-panel]').forEach((button) => {
    const active = button.dataset.mobilePanel === state.mobilePanel
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
}

function setCameraMode(viewer, mode) {
  state.cameraMode = mode
  document.querySelectorAll('#cameraMode .cn-btn').forEach((button) => {
    if (button.dataset.cam) button.classList.toggle('active', button.dataset.cam === mode)
  })
  if (mode === 'overview') setOverviewCamera(viewer)
  else updateCamera(viewer, viewer.clock)
  const progress = Math.max(0, Math.min(1, Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, viewer.clock.startTime) / state.totalDurationS))
  updateMiniMap(progress)
}

function toggleFocusMode(button = document.getElementById('btnFocus')) {
  const focused = document.body.classList.toggle('focus-mode')
  button.classList.toggle('active', focused)
  button.textContent = focused ? 'Exit focus' : 'Focus'
}

function setCommandPaletteOpen(open) {
  els.commandPalette.classList.toggle('open', open)
  els.commandPalette.setAttribute('aria-hidden', String(!open))
  if (!open) return
  els.commandSearch.value = ''
  filterCommandPalette()
  requestAnimationFrame(() => els.commandSearch.focus())
}

function filterCommandPalette() {
  const query = els.commandSearch.value.trim().toLowerCase()
  let visible = 0
  els.commandList.querySelectorAll('[data-command]').forEach((item) => {
    const match = item.textContent.toLowerCase().includes(query)
    item.hidden = !match
    if (match) visible++
  })
  els.commandEmpty.classList.toggle('visible', visible === 0)
}

function runCommand(viewer, command) {
  if (command.startsWith('phase:')) jumpToPhase(viewer, command.slice(6))
  else if (command.startsWith('view:')) setCameraMode(viewer, command.slice(5))
  else if (command === 'comparison') setComparisonOpen(true)
  else if (command === 'benchmark') setBenchmarkOpen(true)
  else if (command === 'weather') setWeatherEnabled(!state.weatherEnabled)
  else if (command === 'focus') toggleFocusMode()
  setCommandPaletteOpen(false)
}

function jumpToPhase(viewer, phase) {
  const fraction = state.phaseAnchors[phase]
  if (fraction === undefined || !state.totalDurationS) return
  viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
    viewer.clock.startTime,
    fraction * state.totalDurationS,
    new Cesium.JulianDate(),
  )
  tick(viewer, viewer.clock)
  els.liveRegion.textContent = `Jumped to ${phase}.`
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
  updateMiniMap(t)
  updateAircraftHover(viewer)

  els.hudProgress.textContent = `${(t * 100).toFixed(1)}%`
  els.progressBarFill.style.width = `${t * 100}%`
  els.timeline.value = String(Math.round(t * Number(els.timeline.max)))
  els.hudElapsed.textContent = fmtTime(elapsed)
  els.hudFuelUsed.textContent = `${cumGt.toFixed(0)} kg`
  els.hudFuelRemaining.textContent = `${Math.max(0, state.totalFuelKg - cumGt).toFixed(0)} kg`

  // Force meters from flight state.
  updateForceMeters(iv)
  updateWeatherReadout(iv, t)
  updateMassPanel(iv, cumGt)
  updatePhaseIndicator(iv, t)

  // Prediction comparison.
  updatePredictionComparison(iv, idx, cumGt, cumPhys, cumR3)
  if (t >= 0.999 && !state.completed) showCompletion(cumGt, cumPhys, cumR3)
}

function updatePhaseIndicator(iv, progress) {
  const phase = getFlightPhase(iv, progress)
  document.querySelectorAll('[data-phase-step]').forEach((step) => step.classList.toggle('active', step.dataset.phaseStep === phase))
}

function getFlightPhase(interval, progress) {
  let phase = interval?.phase && interval.phase !== 'unknown' ? interval.phase.toLowerCase() : ''
  if (!phase) phase = progress < 0.04 ? 'takeoff' : progress < 0.15 ? 'climb' : progress < 0.9 ? 'cruise' : progress < 0.98 ? 'descent' : 'landing'
  return phase
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
  const baselineAbsErr = Math.abs(physErr)
  const r3AbsErr = Math.abs(r3Err)
  const improvement = baselineAbsErr > 0 ? (1 - r3AbsErr / baselineAbsErr) * 100 : 0

  els.predGt.textContent = `${gt.toFixed(0)} kg`
  els.predOpenap.textContent = `${phys.toFixed(0)} kg`
  els.predR3.textContent = `${r3.toFixed(0)} kg`
  els.predOpenapErr.textContent = `${physErr >= 0 ? '+' : ''}${physErr.toFixed(0)} kg`
  els.predR3Err.textContent = `${r3Err >= 0 ? '+' : ''}${r3Err.toFixed(0)} kg`
  els.predR3Rel.textContent = `${r3RelErr.toFixed(1)}%`
  els.predImprovement.textContent = improvement >= 0
    ? `R3 lowers interval error by ${improvement.toFixed(0)}%`
    : `R3 interval error is ${Math.abs(improvement).toFixed(0)}% higher`
  els.predImprovement.classList.toggle('positive', improvement >= 0)
  els.predImprovement.classList.toggle('negative', improvement < 0)

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

function setComparisonOpen(open) {
  els.comparisonModal.classList.toggle('open', open)
  els.comparisonModal.setAttribute('aria-hidden', String(!open))
  if (open) drawChart()
}

function setBenchmarkOpen(open) {
  els.benchmarkModal.classList.toggle('open', open)
  els.benchmarkModal.setAttribute('aria-hidden', String(!open))
}

function drawChart() {
  drawChartCanvas(els.predChart)
  drawChartCanvas(els.predChartExpanded)
  drawChartCanvas(els.reportChart, { mode: 'cumulative', layout: 'overlay' })
  drawReportCharts()
}

function drawReportCharts() {
  const actual = state.intervals.map((interval) => interval.groundTruth)
  const physics = state.intervals.map((interval) => interval.physicsFuelKg)
  const r3 = state.intervals.map((interval) => interval.r3Prediction)
  const colors = state.printing
    ? { actual: '#111827', physics: '#475569', r3: '#dc1414' }
    : { actual: '#ffffff', physics: 'rgba(255,255,255,.52)', r3: '#dc1414' }
  drawReportLineChart(els.reportIntervalChart, [
    { values: actual, color: colors.actual },
    { values: physics, color: colors.physics, dashed: true },
    { values: r3, color: colors.r3 },
  ])
  drawReportLineChart(els.reportErrorChart, [
    { values: physics.map((value, index) => Math.abs(value - actual[index])), color: colors.physics, dashed: true },
    { values: r3.map((value, index) => Math.abs(value - actual[index])), color: colors.r3 },
  ])
}

function drawReportLineChart(canvas, series) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = state.printing ? '#ffffff' : '#101318'
  ctx.fillRect(0, 0, W, H)
  const max = Math.max(...series.flatMap((line) => line.values), 1)
  const pad = { x: 34, y: 22 }

  ctx.strokeStyle = state.printing ? 'rgba(15,23,42,.18)' : 'rgba(255,255,255,.1)'
  ctx.lineWidth = 1
  ctx.setLineDash([])
  for (let line = 0; line < 4; line++) {
    const y = pad.y + ((H - pad.y * 2) / 3) * line
    ctx.beginPath()
    ctx.moveTo(pad.x, y)
    ctx.lineTo(W - 8, y)
    ctx.stroke()
  }
  ctx.fillStyle = state.printing ? '#475569' : 'rgba(255,255,255,.58)'
  ctx.font = '600 20px system-ui'
  ctx.fillText(`${max.toFixed(0)} kg`, 2, pad.y + 6)
  ctx.fillText('0', 14, H - pad.y + 6)

  series.forEach(({ values, color, dashed }) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 4
    ctx.setLineDash(dashed ? [10, 9] : [])
    ctx.beginPath()
    values.forEach((value, index) => {
      const x = pad.x + (index / Math.max(1, values.length - 1)) * (W - pad.x - 8)
      const y = H - pad.y - (value / max) * (H - pad.y * 2)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  })
  ctx.setLineDash([])
}

function drawChartCanvas(canvas, options = {}) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = state.printing ? '#ffffff' : '#101318'
  ctx.fillRect(0, 0, W, H)

  const mode = options.mode || state.chartMode
  const layout = options.layout || state.chartLayout
  const actual = mode === 'rate' ? state.chartActualRate : state.chartActual
  const phys = mode === 'rate' ? state.chartPhysicsRate : state.chartPhysics
  const r3 = mode === 'rate' ? state.chartR3Rate : state.chartR3
  if (actual.length === 0) return

  const maxVal = Math.max(...actual, ...phys, ...r3, 1)

  const trace = (values, top, height, color, dashed = false) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.setLineDash(dashed ? [3, 3] : [])
    ctx.beginPath()
    values.forEach((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * (W - 8) + 4
      const y = top + height - 5 - (value / maxVal) * (height - 12)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  const grid = (top, height) => {
    ctx.strokeStyle = state.printing ? 'rgba(15,23,42,.18)' : 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.setLineDash([])
    for (let line = 1; line < 3; line++) {
      const y = top + (height / 3) * line
      ctx.beginPath()
      ctx.moveTo(4, y)
      ctx.lineTo(W - 4, y)
      ctx.stroke()
    }
  }

  if (layout === 'split') {
    const half = Math.floor(H / 2)
    grid(0, half)
    grid(half, half)
    ctx.fillStyle = state.printing ? '#475569' : 'rgba(255,255,255,.58)'
    ctx.font = '700 9px system-ui'
    ctx.fillText('PHYSICS BASELINE', 8, 12)
    ctx.fillText('AEROTWIN R3', 8, half + 12)
    trace(actual, 0, half, state.printing ? '#111827' : '#ffffff')
    trace(phys, 0, half, state.printing ? '#475569' : 'rgba(255,255,255,.5)', true)
    trace(actual, half, half, state.printing ? '#111827' : '#ffffff')
    trace(r3, half, half, '#dc1414')
  } else {
    grid(0, H)
    trace(phys, 0, H, state.printing ? '#475569' : 'rgba(255,255,255,.5)', true)
    trace(actual, 0, H, state.printing ? '#111827' : '#ffffff')
    trace(r3, 0, H, '#dc1414')
  }
  ctx.setLineDash([])
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
  populateFlightReport(fuel, physics, r3, improvement)
  els.completionModal.classList.add('open')
  els.completionModal.setAttribute('aria-hidden', 'false')
  els.liveRegion.textContent = 'Flight complete. Simulation summary is open.'
}

function populateFlightReport(fuel, physics, r3, improvement) {
  const actualValues = state.intervals.map((interval) => interval.groundTruth)
  const physicsValues = state.intervals.map((interval) => interval.physicsFuelKg)
  const r3Values = state.intervals.map((interval) => interval.r3Prediction)
  // Use the complete stored replay for the printable report, even if the clock
  // callback arrives a fraction before its final sample.
  fuel = actualValues.reduce((sum, value) => sum + value, 0)
  physics = physicsValues.reduce((sum, value) => sum + value, 0)
  r3 = r3Values.reduce((sum, value) => sum + value, 0)
  const physicsError = physics - fuel
  const r3Error = r3 - fuel
  improvement = Math.abs(physicsError) > 0 ? (1 - Math.abs(r3Error) / Math.abs(physicsError)) * 100 : 0
  const physicsIntervalErrors = physicsValues.map((value, index) => Math.abs(value - actualValues[index]))
  const r3IntervalErrors = r3Values.map((value, index) => Math.abs(value - actualValues[index]))
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  const takeoffMass = 42600 + 15000 + state.totalFuelKg
  const finalMass = takeoffMass - fuel
  const fuelRemaining = Math.max(0, state.totalFuelKg - fuel)
  els.reportRoute.textContent = `${els.completionRoute.textContent} · ${els.hudAircraft.textContent}`
  els.reportDuration.textContent = fmtTime(state.totalDurationS)
  els.reportFuel.textContent = `${fuel.toFixed(0)} kg`
  els.reportR3Error.textContent = `${r3Error >= 0 ? '+' : ''}${r3Error.toFixed(0)} kg`
  els.reportImprovement.textContent = `${improvement.toFixed(1)}%`
  els.reportMeasured.textContent = `${fuel.toFixed(0)} kg`
  els.reportPhysics.textContent = `${physics.toFixed(0)} kg`
  els.reportPhysicsError.textContent = `${Math.abs(physicsError).toFixed(0)} kg`
  els.reportR3.textContent = `${r3.toFixed(0)} kg`
  els.reportR3AbsError.textContent = `${Math.abs(r3Error).toFixed(0)} kg`
  els.reportPhysicsTotal.textContent = `${physics.toFixed(0)} kg`
  els.reportR3Total.textContent = `${r3.toFixed(0)} kg`
  els.reportPhysicsFinalAbs.textContent = `${Math.abs(physicsError).toFixed(0)} kg`
  els.reportR3FinalAbs.textContent = `${Math.abs(r3Error).toFixed(0)} kg`
  els.reportPhysicsRelative.textContent = `${(Math.abs(physicsError) / Math.max(fuel, 1) * 100).toFixed(2)}%`
  els.reportR3Relative.textContent = `${(Math.abs(r3Error) / Math.max(fuel, 1) * 100).toFixed(2)}%`
  els.reportPhysicsMae.textContent = `${mean(physicsIntervalErrors).toFixed(1)} kg`
  els.reportR3Mae.textContent = `${mean(r3IntervalErrors).toFixed(1)} kg`
  els.reportPhysicsWorst.textContent = `${Math.max(...physicsIntervalErrors, 0).toFixed(0)} kg`
  els.reportR3Worst.textContent = `${Math.max(...r3IntervalErrors, 0).toFixed(0)} kg`
  els.reportTakeoffMass.textContent = `${(takeoffMass / 1000).toFixed(1)} t`
  els.reportFinalMass.textContent = `${(finalMass / 1000).toFixed(1)} t`
  els.reportFuelRemaining.textContent = `${fuelRemaining.toFixed(0)} kg`
  els.reportWingLoading.textContent = `${(finalMass / 122.6).toFixed(0)} kg/m²`
  els.reportPhase.textContent = els.massPhase.textContent
  els.reportBurnRate.textContent = els.massBurnRate.textContent
  els.reportThrust.textContent = els.thrustVal.textContent
  els.reportDragLift.textContent = `${els.dragVal.textContent} / ${els.liftVal.textContent}`
  populateMissionDebrief()
  drawChart()
}

function populateMissionDebrief() {
  const phaseOrder = ['takeoff', 'climb', 'cruise', 'descent', 'landing']
  const phaseLabels = { takeoff: 'Takeoff', climb: 'Climb', cruise: 'Cruise', descent: 'Descent', landing: 'Landing' }
  const eventLedger = phaseOrder.map((phase) => ({
    phase,
    label: phaseLabels[phase],
    fraction: state.phaseAnchors[phase],
    time: state.phaseAnchors[phase] * state.totalDurationS,
  }))
  els.reportEvents.replaceChildren(...eventLedger.map((event) => {
    const item = document.createElement('li')
    const label = document.createElement('b')
    const time = document.createElement('span')
    label.textContent = event.label
    time.textContent = fmtTime(event.time)
    item.append(label, time)
    return item
  }))

  const phases = Object.fromEntries(phaseOrder.map((phase) => [phase, {
    phase, duration: 0, fuel: 0, r3Error: 0, intervals: 0,
  }]))
  let elapsed = 0
  state.intervals.forEach((interval) => {
    const midpoint = (elapsed + interval.durationS / 2) / state.totalDurationS
    const phase = getFlightPhase(null, midpoint)
    const group = phases[phase]
    group.duration += interval.durationS
    group.fuel += interval.groundTruth
    group.r3Error += Math.abs(interval.r3Prediction - interval.groundTruth)
    group.intervals++
    elapsed += interval.durationS
  })
  const phaseData = phaseOrder.map((phase) => phases[phase])
  els.reportPhaseSummary.replaceChildren(...phaseData.map((group) => {
    const row = document.createElement('tr')
    const values = [
      phaseLabels[group.phase], fmtTime(group.duration), `${group.fuel.toFixed(0)} kg`,
      `${(group.fuel / Math.max(group.duration, 1)).toFixed(2)} kg/s`,
      `${(group.r3Error / Math.max(group.intervals, 1)).toFixed(1)} kg`,
    ]
    values.forEach((value) => {
      const cell = document.createElement('td')
      cell.textContent = value
      row.append(cell)
    })
    return row
  }))

  const highestAltitude = Math.max(...state.intervals.map((interval) => interval.altitudeM || 0), 0)
  const speeds = state.intervals.map((interval) => interval.groundSpeedMps || 0).filter((value) => value > 0)
  const peakSpeed = speeds.length ? Math.max(...speeds) : null
  const peakBurn = Math.max(...state.intervals.map((interval) => interval.groundTruth / Math.max(interval.durationS, 1)), 0)
  const peakError = Math.max(...state.intervals.map((interval) => Math.abs(interval.r3Prediction - interval.groundTruth)), 0)
  els.reportPeakAltitude.textContent = `${(highestAltitude / 1000).toFixed(1)} km`
  els.reportPeakSpeed.textContent = peakSpeed ? `${Math.round(peakSpeed * 1.94384)} kt` : 'Unavailable'
  els.reportPeakBurn.textContent = `${peakBurn.toFixed(2)} kg/s`
  els.reportPeakError.textContent = `${peakError.toFixed(0)} kg`

  state.reportExport = { eventLedger, phaseData, intervals: state.intervals.map((interval, index) => ({
    interval: index + 1,
    phase: getFlightPhase(null, (index + 0.5) / state.intervals.length),
    durationSeconds: interval.durationS,
    altitudeMetres: interval.altitudeM || null,
    groundSpeedMps: interval.groundSpeedMps || null,
    measuredFuelKg: interval.groundTruth,
    physicsFuelKg: interval.physicsFuelKg,
    r3PredictionKg: interval.r3Prediction,
    r3AbsoluteErrorKg: Math.abs(interval.r3Prediction - interval.groundTruth),
  })) }
}

function exportFlightReport(format) {
  if (!state.reportExport) return
  let content
  let type
  let suffix
  if (format === 'json') {
    content = JSON.stringify({
      route: els.completionRoute.textContent,
      aircraft: els.hudAircraft.textContent,
      source: 'Bundled PRC demo replay data; frontend-derived phase and summary values.',
      ...state.reportExport,
    }, null, 2)
    type = 'application/json'
    suffix = 'json'
  } else {
    const headers = Object.keys(state.reportExport.intervals[0])
    content = [headers.join(','), ...state.reportExport.intervals.map((row) => headers.map((key) => JSON.stringify(row[key] ?? '')).join(','))].join('\n')
    type = 'text/csv'
    suffix = 'csv'
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([content], { type }))
  link.download = `aeroflux-flight-report.${suffix}`
  link.click()
  URL.revokeObjectURL(link.href)
}

function prepareReportPrint() {
  state.printing = true
  drawChart()
  // Give the canvas a paint cycle with its print palette before Chrome captures it.
  requestAnimationFrame(() => window.print())
}

function setFlightReportOpen(open) {
  els.flightReportModal.classList.toggle('open', open)
  els.flightReportModal.setAttribute('aria-hidden', String(!open))
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
  setFlightReportOpen(false)
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
