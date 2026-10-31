"use client";

import { useState } from "react";

interface RepurposedContent {
  linkedin: string[];
  tweets: string[];
  emails: Array<{ subject: string; preview: string; body: string }>;
  youtubeShort: { hook: string; script: string; visualCues: string[] };
  meta: { sourceWords: number; generatedAt: string; model: string };
}

const EXAMPLE_BLOG = `5 Cost-Effective Cybersecurity Basics Every Small Business Should Do This Quarter

Most small-business cyber incidents are not the work of a state-sponsored hacker. They come from the boring stuff: a login page that still works months after someone left, a laptop that never got its last update, a backup set up once and never tested. The good news is that the boring stuff is exactly where the cheapest, fastest wins live.

Here are five basics that cost very little (often nothing) and cut real risk this quarter.

## 1. Turn on multi-factor authentication everywhere

A stolen password is the number-one entry point. MFA closes most of that door, and the big providers (Google Workspace, Microsoft 365, your banking, your CRM) all offer it for free. The one rule that matters: no one gets an exception. The founder, the bookkeeper, the intern, all of them.

## 2. Back up, then actually test the restore

"Backed up" and "recoverable" are not the same thing. Use the 3-2-1 rule: three copies, on two different kinds of storage, with one copy off-site or in the cloud. The part most teams skip is the restore test. Pick one file a month and pull it back.

## 3. Automate the updates you keep putting off

Patching is unglamorous, and delays add up. Most operating systems and popular apps will update automatically, so let them. For the rest, block out a recurring "patch window" and make it a standing item.

## 4. Run a ten-minute phishing drill

Your team is your first firewall, but only if they are primed. Once a quarter, send a harmless fake phishing email and see who clicks. Do not shame the people who do. Just give the two-minute "what just happened" and a retake.

## 5. Lock down who can actually access what

Audit who has access to what, then trim it. When someone changes roles or leaves, that is the moment to revoke. Pair this with a password manager so you are not reusing the same login across five tools.

None of this needs a security budget or a vendor call. It needs an hour a week and a habit.`;

export function RepurposeTool() {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RepurposedContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (source.trim().length < 100) {
      setError("Paste at least 100 characters of source content.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/repurpose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "free_tier_exceeded") {
          setError(
            `${data.message} Upgrade at /pricing to keep going.`
          );
        } else {
          setError(data.message || data.error || "Something went wrong.");
        }
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  function loadExample() {
    setSource(EXAMPLE_BLOG);
    setError(null);
    setResult(null);
  }

  function copyToClipboard(text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="source" className="block text-sm font-medium text-ink">
            Paste your blog post (or any long-form content)
          </label>
          <textarea
            id="source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Paste 100+ words here. The more context, the better the output."
            rows={10}
            className="input mt-2 font-mono text-sm"
            disabled={loading}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-ink/50">
            <span>{source.length.toLocaleString()} characters</span>
            <button
              type="button"
              onClick={loadExample}
              className="text-ink/60 hover:text-ink"
              disabled={loading}
            >
              Load example
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-accent">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Repurposing..." : "Repurpose"}
          </button>
          <span className="text-xs text-ink/50">Takes ~15-30 seconds.</span>
        </div>
      </form>

      {result && (
        <div className="mt-10 space-y-8 border-t border-ink/10 pt-8">
          <ResultSection title="5 LinkedIn posts" items={result.linkedin} onCopy={copyToClipboard} />
          <ResultSection title="8 tweets" items={result.tweets} onCopy={copyToClipboard} />
          <div>
            <h3 className="mb-3 font-serif text-xl font-semibold">3 newsletter emails</h3>
            <div className="space-y-4">
              {result.emails.map((email, i) => (
                <div key={i} className="rounded-md border border-ink/10 bg-paper p-4">
                  <div className="mb-1 text-sm font-medium text-ink">
                    Subject: {email.subject}
                  </div>
                  <div className="mb-3 text-xs text-ink/50">
                    Preview: {email.preview}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-ink/80">{email.body}</p>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        `Subject: ${email.subject}\n\n${email.preview}\n\n${email.body}`
                      )
                    }
                    className="mt-3 text-xs text-ink/50 hover:text-ink"
                  >
                    Copy full email
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-3 font-serif text-xl font-semibold">YouTube Short script</h3>
            <div className="rounded-md border border-ink/10 bg-paper p-4">
              <div className="mb-2 text-sm font-medium text-ink">
                Hook: {result.youtubeShort.hook}
              </div>
              <p className="whitespace-pre-wrap text-sm text-ink/80">
                {result.youtubeShort.script}
              </p>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-ink/50 hover:text-ink">
                  Visual cues ({result.youtubeShort.visualCues.length})
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-ink/70">
                  {result.youtubeShort.visualCues.map((cue, i) => (
                    <li key={i}>{cue}</li>
                  ))}
                </ul>
              </details>
            </div>
          </div>
          <div className="text-xs text-ink/40">
            Generated with {result.meta.model} from {result.meta.sourceWords.toLocaleString()}{" "}
            source words at {new Date(result.meta.generatedAt).toLocaleString()}.
          </div>
        </div>
      )}
    </div>
  );
}

function ResultSection({
  title,
  items,
  onCopy,
}: {
  title: string;
  items: string[];
  onCopy: (text: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-3 font-serif text-xl font-semibold">{title}</h3>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-md border border-ink/10 bg-paper p-4">
            <p className="whitespace-pre-wrap text-sm text-ink/80">{item}</p>
            <button
              type="button"
              onClick={() => onCopy(item)}
              className="mt-3 text-xs text-ink/50 hover:text-ink"
            >
              Copy
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
