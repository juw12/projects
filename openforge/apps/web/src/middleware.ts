import { NextResponse, type NextRequest } from 'next/server'

// Phase 0: in-memory token bucket per IP. Phase 1: replace with Redis (e.g. @upstash/ratelimit).
const buckets = new Map<string, { tokens: number; lastRefill: number }>()
const REFILL_RATE = 1  // tokens per second
const BUCKET_SIZE = 30  // max burst

export function middleware(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  const now = Date.now() / 1000
  let bucket = buckets.get(ip)
  if (!bucket) {
    bucket = { tokens: BUCKET_SIZE, lastRefill: now }
    buckets.set(ip, bucket)
  } else {
    const elapsed = now - bucket.lastRefill
    bucket.tokens = Math.min(BUCKET_SIZE, bucket.tokens + elapsed * REFILL_RATE)
    bucket.lastRefill = now
  }
  if (bucket.tokens < 1) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 })
  }
  bucket.tokens -= 1
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
}
