// Loads the bundled validation flight and adapts its dataset field names for
// the simulator UI. Keeping this at the boundary lets the simulation use the
// original PRC-exported JSON without duplicating or altering the source data.

const DEMO_FLIGHT_URL = '/models/demo_flight.json'

export async function loadDemoFlight() {
  const response = await fetch(DEMO_FLIGHT_URL)
  if (!response.ok) {
    throw new Error(`Could not load demo flight data (${response.status})`)
  }

  const rows = await response.json()
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Demo flight data is empty or invalid')
  }

  const intervals = rows.map((row) => ({
    durationS: Number(row.duration_s) || 0,
    groundTruth: Number(row.ground_truth) || 0,
    physicsFuelKg: Number(row.physics_fuel_kg) || 0,
    r3Prediction: Number(row.teacher_prediction) || 0,
    phase: row.phase || 'unknown',
    // The exported telemetry is in feet, knots, and feet/minute.
    altitudeM: Number(row.mean_altitude) * 0.3048,
    groundSpeedMps: Number(row.mean_groundspeed) * 0.514444,
    verticalRateMps: Number(row.mean_vertical_rate) * 0.00508,
  }))

  return {
    origin: 'LHR',
    originName: 'London Heathrow',
    destination: 'JFK',
    destinationName: 'New York John F. Kennedy',
    aircraftType: 'A320 family',
    intervals,
  }
}
