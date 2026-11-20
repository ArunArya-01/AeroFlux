export default async function handler() {
  return new Response(null, {
    status: 302,
    headers: { location: '/models/demo_flight.json', 'cache-control': 'no-store' },
  })
}

