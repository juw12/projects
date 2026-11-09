"""PM Agent — turns a daily idea into a build-ready product spec.

Reads an idea dict (from the Idea Agent) and produces a one-page Markdown
spec that a non-technical person can paste verbatim into a vibe-coding
tool (Lovable, Bolt.new, v0.dev) to generate the actual app.
"""
from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from google import genai

load_dotenv()

DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


def _client() -> genai.Client:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to your .env file or "
            "GitHub Actions secrets. Get a free key at https://aistudio.google.com/."
        )
    return genai.Client(api_key=api_key)


SYSTEM_PROMPT = """You are the PM Agent for a small product studio.

You receive a single app idea and produce a one-page Markdown spec that a
non-technical founder can paste verbatim into Lovable, Bolt.new, or v0.dev
to generate a working web app.

Hard rules:
- The spec must be specific enough to build in under 2 hours in a vibe-coding tool.
- Define 3-5 core features. No more — scope creep kills small apps.
- Specify the user flow as numbered steps.
- Include a "vibe-coding prompt" at the bottom: one paragraph the user
  can paste directly into the tool to generate the app.
- Mention any third-party APIs the build will need (auth, payments, etc.).
- Do NOT include code, only product-level specs.
- Use simple language, no jargon.

Return ONLY valid Markdown. No commentary, no wrapping code fences.
"""


def _format_idea(idea: dict[str, Any]) -> str:
    return "\n".join(f"- **{k}**: {v}" for k, v in idea.items())


def generate_spec(idea: dict[str, Any]) -> str:
    """Turn an idea dict into a Markdown product spec."""
    client = _client()

    user_prompt = (
        "Here is today's app idea:\n\n"
        f"{_format_idea(idea)}\n\n"
        "Write the one-page product spec now. Use this template:\n\n"
        "# <Product Name>\n\n"
        "## One-liner\n<one sentence>\n\n"
        "## Who it's for\n<specific persona + the pain point in their words>\n\n"
        "## Core features (3-5 only)\n"
        "1. <feature> — <one-line description>\n"
        "2. ...\n\n"
        "## User flow\n"
        "1. Visitor arrives at...\n"
        "2. ...\n"
        "n. ...\n\n"
        "## Pages / screens\n"
        "- <page>: <what's on it>\n\n"
        "## Data needed\n"
        "- <what data the app stores or fetches>\n\n"
        "## Third-party services\n"
        "- <auth, payments, APIs>\n\n"
        "## Vibe-coding prompt\n"
        "<one paragraph, ready to paste into Lovable/Bolt/v0>\n\n"
        "## Out of scope (for v1)\n"
        "- <things we explicitly will not build>\n"
    )

    response = client.models.generate_content(
        model=DEFAULT_MODEL,
        contents=user_prompt,
        config={
            "system_instruction": SYSTEM_PROMPT,
            "temperature": 0.7,
        },
    )

    return (response.text or "").strip()


if __name__ == "__main__":
    sample = {
        "title": "InvoiceSnap",
        "category": "SaaS tool",
        "one_liner": "Turn a photo of a paper invoice into a clean spreadsheet row in 10 seconds.",
        "target_user": "Solo freelancers who hate bookkeeping",
        "pain_point": "Manually typing invoice data into spreadsheets every week",
        "why_now": "Vision LLMs are finally accurate enough for receipts",
        "monetization": "$9/mo after 5 free invoices",
        "build_complexity": "Medium",
    }
    print(generate_spec(sample))
