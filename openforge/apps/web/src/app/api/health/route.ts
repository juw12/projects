export async function GET() {
  const url = `${process.env.NEXT_PUBLIC_API_URL}/healthz`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    return Response.json(await res.json(), { status: res.status })
  } catch (e) {
    return Response.json({ status: 'down', error: 'api unreachable' }, { status: 503 })
  }
}
