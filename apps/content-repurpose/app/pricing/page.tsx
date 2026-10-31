import Link from "next/link";

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <header className="mb-12 flex items-center justify-between">
        <Link href="/" className="font-serif text-2xl font-semibold tracking-tight">
          Atomize
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/" className="text-ink/70 hover:text-ink">
            Home
          </Link>
        </nav>
      </header>

      <section className="mb-12">
        <h1 className="font-serif text-4xl font-semibold tracking-tight">Pricing</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink/70">
          Start free. Upgrade when you publish more than three articles a month.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        <PricingCard
          name="Free"
          price="$0"
          cadence=""
          description="For trying it out on a single post."
          features={[
            "3 repurposes total",
            "All 17 outputs per repurpose",
            "No card required",
          ]}
          cta={
            <Link href="/" className="btn-secondary w-full">
              Start free
            </Link>
          }
        />
        <PricingCard
          name="Pro"
          price="$19"
          cadence="/ month"
          description="For founders publishing weekly."
          features={[
            "50 repurposes per month",
            "All 17 outputs per repurpose",
            "Priority generation queue",
            "Cancel anytime",
          ]}
          highlighted
          cta={
            <a href="/api/checkout?plan=pro" className="btn-primary w-full">
              Start Pro
            </a>
          }
        />
        <PricingCard
          name="Power"
          price="$49"
          cadence="/ month"
          description="For agencies and content teams."
          features={[
            "Unlimited repurposes",
            "All 17 outputs per repurpose",
            "Priority generation queue",
            "API access (beta)",
            "Cancel anytime",
          ]}
          cta={
            <a href="/api/checkout?plan=power" className="btn-primary w-full">
              Start Power
            </a>
          }
        />
      </section>

      <section className="mt-16 rounded-lg border border-ink/10 bg-paper p-8">
        <h2 className="font-serif text-2xl font-semibold">FAQ</h2>
        <div className="mt-6 space-y-6 text-sm">
          <div>
            <h3 className="font-medium">How does the free tier work?</h3>
            <p className="mt-1 text-ink/70">
              Three repurposes, no card. After that, upgrade to keep going.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Do you store my content?</h3>
            <p className="mt-1 text-ink/70">
              No. Source text is sent to Claude for generation and discarded. We do not train on
              it, and we do not retain it.
            </p>
          </div>
          <div>
            <h3 className="font-medium">What payment methods work?</h3>
            <p className="mt-1 text-ink/70">
              All major cards and most local payment methods via Lemon Squeezy. Works in Taiwan.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Can I cancel?</h3>
            <p className="mt-1 text-ink/70">
              Yes, anytime from your Lemon Squeezy customer portal. No questions asked.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function PricingCard({
  name,
  price,
  cadence,
  description,
  features,
  highlighted,
  cta,
}: {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  highlighted?: boolean;
  cta: React.ReactNode;
}) {
  return (
    <div
      className={`card flex flex-col ${
        highlighted ? "border-ink/30 shadow-md" : ""
      }`}
    >
      <h2 className="font-serif text-2xl font-semibold">{name}</h2>
      <p className="mt-2 text-sm text-ink/60">{description}</p>
      <div className="mt-4 flex items-baseline">
        <span className="font-serif text-4xl font-semibold">{price}</span>
        <span className="ml-1 text-sm text-ink/60">{cadence}</span>
      </div>
      <ul className="mt-6 space-y-2 text-sm">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <span className="mt-0.5 text-accent">·</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8">{cta}</div>
    </div>
  );
}
