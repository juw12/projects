import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { default: 'OpenForge', template: '%s · OpenForge' },
  description: 'Self-hosted GitHub competitor',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
