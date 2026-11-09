import { authClient } from '@/lib/auth-client'

// Better Auth's handler is normally mounted on the API server. For Next.js BFF pattern,
// we proxy auth calls to the API. Better Auth also has a Next.js handler; use whichever
// pattern fits best. For Phase 0, we'll just use the Better Auth client SDK and rely on
// the API server's /api/auth/* routes.
export const GET = () => new Response('Use the API server auth routes', { status: 404 })
