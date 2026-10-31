import Link from "next/link";
import { RepurposeTool } from "@/components/RepurposeTool";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <header className="mb-12 flex items-center justify-between">
        <div className="font-serif text-2xl font-semibold tracking-tight">Atomize</div>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/pricing" className="text-ink/70 hover:text-ink">
            Pricing
          </Link>
          <a href="#tool" className="btn-primary">
            Try it free
          </a>
        </nav>
      </header>

      <section className="mb-16">
        <h1 className="font-serif text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Turn one blog post into a week of content.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-ink/70">
          Paste your article. Get 5 LinkedIn posts, 8 tweets, 3 newsletters, and a YouTube Short
          script. Same voice, every channel, under a minute.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#tool" className="btn-primary">
            Paste and repurpose
          </a>
          <Link href="/pricing" className="btn-secondary">
            See pricing
          </Link>
        </div>
      </section>

      <section id="tool" className="card scroll-mt-8">
        <RepurposeTool />
      </section>

      <section className="mt-16 grid gap-6 sm:grid-cols-3">
        <div className="card">
          <h3 className="font-serif text-lg font-semibold">One source, ten posts</h3>
          <p className="mt-2 text-sm text-ink/70">
            600 words in. 5 LinkedIn + 8 tweets + 3 emails + 1 short script out. Same voice across
            channels.
          </p>
        </div>
        <div className="card">
          <h3 className="font-serif text-lg font-semibold">Built for founders</h3>
          <p className="mt-2 text-sm text-ink/70">
            Write once on your blog, be everywhere else the same week. No scheduler, no agency.
          </p>
        </div>
        <div className="card">
          <h3 className="font-serif text-lg font-semibold">Free to start</h3>
          <p className="mt-2 text-sm text-ink/70">
            Three repurposes on the house, no card. Upgrade when you need more.
          </p>
        </div>
      </section>

      <footer className="mt-24 border-t border-ink/10 pt-8 text-sm text-ink/50">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>Atomize — paste, repurpose, publish.</div>
          <div>
            <Link href="/pricing" className="hover:text-ink">
              Pricing
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
