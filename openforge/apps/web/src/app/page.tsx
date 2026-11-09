import Link from 'next/link'

export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>OpenForge</h1>
      <p>Self-hosted GitHub competitor. Phase 0 — skeleton.</p>
      <nav>
        <Link href="/login">Sign in</Link>
        {' · '}
        <Link href="/api/health">API health</Link>
      </nav>
    </main>
  )
}
