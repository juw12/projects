"""Idea Agent — picks a daily app idea to build.

Reads recent specs from specs/ to avoid repeating ideas, then asks Gemini
to generate a fresh, shippable web-app concept. Output is structured JSON
that the PM Agent will turn into a buildable spec.
"""
from __future__ import annotations

import json
import os
import random
from datetime import date
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai

# Load .env if present (local dev). In CI/GitHub Actions the env vars are
# injected directly, so this is a no-op there.
load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SPECS_DIR = PROJECT_ROOT / "specs"

# Free-tier default. Override with GEMINI_MODEL env var if you want a different one.
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# Domain hints the user picked. Add or remove freely — these just bias the agent.
PRODUCT_CATEGORIES = [
    "a tiny SaaS tool for freelancers",
    "a one-page landing site for a niche audience",
    "a micro web app that solves one annoying problem",
    "a personal dashboard for tracking a habit or metric",
    "a lightweight marketplace or directory",
    "an AI-powered utility that wraps a single LLM call",
    "a browser-based game or interactive demo",
    "a content site that curates one specific topic daily",
]

RECENT_IDEAS_LIMIT = 20  # how many past ideas to feed back to avoid repeats


def _recent_idea_titles() -> list[str]:
    """Return titles of the most recent specs to discourage duplicates."""
    if not SPECS_DIR.exists():
        return []
    files = sorted(SPECS_DIR.glob("*.json"), reverse=True)[:RECENT_IDEAS_LIMIT]
    titles: list[str] = []
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if title := data.get("idea", {}).get("title"):
                titles.append(title)
        except (json.JSONDecodeError, OSError):
            continue
    return titles


def _client() -> genai.Client:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to your .env file or "
            "GitHub Actions secrets. Get a free key at https://aistudio.google.com/."
        )
    return genai.Client(api_key=api_key)


SYSTEM_PROMPT = """You are the Idea Agent for a small product studio.

Your job: pick ONE fresh, shippable web-app idea for today.

Hard rules:
- Must be buildable as a single-page web app by a non-technical person
  using a vibe-coding tool (Lovable, Bolt.new, v0.dev) in under 2 hours.
- Must be useful to a specific niche audience — not generic.
- Must be different from the recent ideas shown in the user's history.
- Prefer ideas that are monetization-friendly (SaaS, paid tool, affiliate, lead-gen).
- Avoid crypto, NFTs, anything requiring regulated finance, or apps that
  scrape platforms that prohibit scraping.

Return ONLY valid JSON in this exact shape, no markdown, no commentary:
{
  "title": "Short product name (3-6 words)",
  "category": "One of: SaaS tool | Landing page | Micro app | Dashboard | Directory | AI utility | Game | Content site",
  "one_liner": "One sentence (< 120 chars) describing what it does and who it's for",
  "target_user": "Specific persona (e.g. 'indie game devs shipping on Steam')",
  "pain_point": "The exact frustration this solves",
  "why_now": "Why this is timely or trending right now",
  "monetization": "How this could eventually make money",
  "build_complexity": "Low | Medium | High"
}
"""


def generate_idea() -> dict[str, Any]:
    """Generate a fresh app idea, avoiding recent duplicates."""
    client = _client()
    recent = _recent_idea_titles()
    category = random.choice(PRODUCT_CATEGORIES)

    user_prompt_parts = [
        f"Today is {date.today().isoformat()}.",
        f"Category hint: {category}.",
    ]
    if recent:
        user_prompt_parts.append(
            "Recent ideas already shipped (do NOT repeat or closely resemble any of these):\n"
            + "\n".join(f"- {title}" for title in recent)
        )
    user_prompt_parts.append(
        "Return the JSON object exactly as specified. No prose around it."
    )
    user_prompt = "\n\n".join(user_prompt_parts)

    response = client.models.generate_content(
        model=DEFAULT_MODEL,
        contents=user_prompt,
        config={
            "system_instruction": SYSTEM_PROMPT,
            "temperature": 0.95,
            "response_mime_type": "application/json",
        },
    )

    raw = (response.text or "").strip()
    # Strip any stray code fences just in case
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    return json.loads(raw)


if __name__ == "__main__":
    # Smoke test: python -m agents.idea_agent
    idea = generate_idea()
    print(json.dumps(idea, indent=2))
