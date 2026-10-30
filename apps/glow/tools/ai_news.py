"""GlowNews: build apps/glow/web/news/news.json twice a day (stdlib only, plus an optional free AI pass).

What it does
  1. Reads AI news from official lab blogs, major tech outlets, research and community sources
     (RSS/Atom feeds, Hacker News and Hugging Face daily papers). A source that fails is skipped.
  2. Groups the same story from different outlets into one item ("3 sources"), like a newsroom does.
  3. Ranks stories by source quality, how many outlets cover them, community votes and freshness.
  4. Tags each story with a topic (Models, Research, Tools, Business, Policy & safety, Open source).
  5. Optionally (--ai) asks Glow's free no-sign-in AI (OVHcloud, LLM7) for a 2-sentence summary,
     a "why it matters" line and a 5-point briefing. Every AI text is marked as AI-written in the
     app, always links to the original sources, and falls back to the feed's own summary.

Twice a day
  Pages rebuilds every hour. With --live URL the script first reads the copy that is live now;
  if that copy was made after the latest half-day slot (00:00 or 12:00 UTC) it is reused as is,
  so the news changes exactly twice a day. AI summaries and "first seen" times carry over.

Run from the repo root:
  python apps/glow/tools/ai_news.py                        # build now from the feeds
  python apps/glow/tools/ai_news.py --ai                   # ... with AI summaries and briefing
  python apps/glow/tools/ai_news.py --ai --live https://juw12.github.io/projects/glow/news/news.json
  python apps/glow/tools/ai_news.py --selftest             # offline checks of the grouping/ranking
"""
from __future__ import annotations

import argparse
import concurrent.futures
import email.utils
import hashlib
import html
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
OUT_FILE = APP_DIR / "web" / "news" / "news.json"
USER_AGENT = "Mozilla/5.0 (compatible; GlowNews/1.0; +https://juw12.github.io/projects/glow/news/)"
REFRESH_HOURS = 12            # one edition per half day
WINDOW_HOURS = 72             # stories older than this drop off (widened when a quiet spell leaves too few)
MAX_STORIES = 60
AI_SUMMARY_COUNT = 30         # top stories that get an AI summary
AI_TIME_BUDGET = 420          # seconds for the whole AI pass; the edition ships without AI text after that
FETCH_TIMEOUT = 20
# Free AI that needs no key or account, the same services GlowChat uses (chat/app.js KEYLESS_MODELS).
# Tried in order; a busy or used-up one (OVHcloud allows 2 requests a minute per model) hands over to the next.
AI_PROVIDERS = [
    ("OVHcloud Llama 3.3 70B", "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1", "Meta-Llama-3_3-70B-Instruct"),
    ("OVHcloud GPT-OSS 120B", "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1", "gpt-oss-120b"),
    ("OVHcloud Qwen 3.5", "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1", "Qwen3.5-397B-A17B"),
    ("OVHcloud Mistral Small 3.2", "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1", "Mistral-Small-3.2-24B-Instruct-2506"),
    ("LLM7", "https://api.llm7.io/v1", "default"),
]

# kind: lab = official AI lab or company blog, news = tech outlet, research, community.
# weight: how much one mention from this source counts. ai_only: the feed is already about AI.
SOURCES = [
    {"name": "OpenAI", "url": "https://openai.com/news/rss.xml", "kind": "lab", "weight": 3.0, "ai_only": True},
    {"name": "Google DeepMind", "url": "https://deepmind.google/blog/rss.xml", "kind": "lab", "weight": 3.0, "ai_only": True},
    {"name": "Google AI", "url": "https://blog.google/technology/ai/rss/", "kind": "lab", "weight": 2.6, "ai_only": True},
    {"name": "Hugging Face", "url": "https://huggingface.co/blog/feed.xml", "kind": "lab", "weight": 2.2, "ai_only": True},
    {"name": "NVIDIA", "url": "https://blogs.nvidia.com/feed/", "kind": "lab", "weight": 1.8, "ai_only": False},
    {"name": "AWS Machine Learning", "url": "https://aws.amazon.com/blogs/machine-learning/feed/", "kind": "lab", "weight": 1.2, "ai_only": True},
    {"name": "Meta Engineering", "url": "https://engineering.fb.com/feed/", "kind": "lab", "weight": 1.6, "ai_only": False},
    {"name": "TechCrunch", "url": "https://techcrunch.com/category/artificial-intelligence/feed/", "kind": "news", "weight": 2.2, "ai_only": True},
    {"name": "The Verge", "url": "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", "kind": "news", "weight": 2.2, "ai_only": True},
    {"name": "Ars Technica", "url": "https://arstechnica.com/ai/feed/", "kind": "news", "weight": 2.1, "ai_only": True},
    {"name": "MIT Technology Review", "url": "https://www.technologyreview.com/topic/artificial-intelligence/feed", "kind": "news", "weight": 2.1, "ai_only": True},
    {"name": "Wired", "url": "https://www.wired.com/feed/tag/ai/latest/rss", "kind": "news", "weight": 2.0, "ai_only": True},
    {"name": "VentureBeat", "url": "https://venturebeat.com/category/ai/feed/", "kind": "news", "weight": 1.8, "ai_only": True},
    {"name": "The Decoder", "url": "https://the-decoder.com/feed/", "kind": "news", "weight": 1.8, "ai_only": True},
    {"name": "MarkTechPost", "url": "https://www.marktechpost.com/feed/", "kind": "news", "weight": 1.2, "ai_only": True},
    {"name": "Simon Willison", "url": "https://simonwillison.net/atom/everything/", "kind": "community", "weight": 1.6, "ai_only": False},
    {"name": "Import AI", "url": "https://importai.substack.com/feed", "kind": "community", "weight": 1.5, "ai_only": True},
    {"name": "Latent Space", "url": "https://www.latent.space/feed", "kind": "community", "weight": 1.5, "ai_only": True},
]
HN_QUERIES = ["AI", "LLM", "OpenAI", "Anthropic", "Claude", "Gemini", "GPT", "DeepSeek", "Llama", "Mistral", "Qwen", "machine learning", "AI agent"]
HN_MIN_POINTS = 60
HF_PAPERS_URL = "https://huggingface.co/api/daily_papers"

TOPICS = [
    # (id, label, keyword patterns): the first topic that matches wins, in this order.
    ("policy", "Policy & safety", r"\b(regulat\w*|law|laws|lawsuit|sue[sd]?|court|judge|copyright|congress|senate|parliament|eu ai act|ai act|government|ban(s|ned)?|policy|safety|alignment|deepfake|privacy|antitrust|ftc|white house|executive order|national security|tariffs?|export controls?|trump|elections?|military|pentagon|security|vulnerab\w*|hack(s|ed|ers?)?|malware|exploits?|religious exemption)\b"),
    ("business", "Business", r"\b(raises?|raised|funding|valuation|valued|acquir\w*|acquisition|merger|ipo|revenue|investors?|invest\w*|layoffs?|jobs|workforce|hiring|deal|partnership|billion|million|\$1t|trillion|stock|shares|data ?cent(er|re)s?|chips?|gpus?|earnings|water|energy|power grid)\b"),
    ("research", "Research", r"\b(paper|papers|arxiv|study|researchers?|benchmark\w*|dataset|preprint|scientists?|novel method|we propose)\b"),
    ("open", "Open source", r"\b(open[- ]source|open[- ]weights?|open model|hugging ?face|github|apache 2\.0|mit license|weights released|locally|local llm|ollama|llama\.cpp)\b"),
    ("models", "Models", r"\b(gpt[- ]?\d\S*|o\d(-\w+)?|claude|gemini|llama|qwen|deepseek|mistral|grok|phi-\d|gemma|kimi|glm|model|models|llm|reasoning|multimodal|frontier)\b"),
    ("tools", "Tools & apps", r"\b(app|apps|feature|api|agent|agents|agentic|copilot|chatgpt|assistant|plugin|extension|sdk|coding|launch(es|ed)?|rolls? out|update|browser|voice)\b"),
]
TOPIC_LABELS = {topic_id: label for topic_id, label, _ in TOPICS}
TOPIC_PATTERNS = [(topic_id, re.compile(pattern, re.I)) for topic_id, _, pattern in TOPICS]

AI_TERMS = re.compile(
    r"\b(ai|a\.i\.|artificial intelligence|machine learning|deep learning|neural|llms?|gpt\S*|chatgpt|openai|anthropic|claude|"
    r"gemini|deepmind|llama|mistral|qwen|deepseek|copilot|transformer|diffusion|genai|generative|chatbot|agents?|agentic|"
    r"inference|fine-?tun\w*|embedding|rag|hugging ?face|nvidia|cuda|robot\w*)\b",
    re.I,
)
STOPWORDS = set(
    "a an the and or but of in on at to for from by with without as is are was were be been being it its this that these those "
    "into over after before about new how why what when who will can could would should may might says said say than then "
    "more most less just now up down out you your we our they their his her he she them us not no yes all any some via vs "
    "first now here there get gets got make makes made use uses using one two three report reports introducing announcing meet".split()
)


# ----------------------------------------------------------------------------------------------
# Fetching and parsing
# ----------------------------------------------------------------------------------------------
def fetch(url: str, timeout: int = FETCH_TIMEOUT, data: bytes | None = None, headers: dict | None = None) -> bytes:
    request_headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    request_headers.update(headers or {})
    request = urllib.request.Request(url, data=data, headers=request_headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def clean_text(value: str | None, limit: int = 600) -> str:
    """HTML/entities out, whitespace collapsed, cut at a sentence end near the limit."""
    if not value:
        return ""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", value, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(html.unescape(text))
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"(The post .+? appeared first on .+?\.?$)", "", text).strip()
    text = re.sub(r"\s*(Continue reading|Read more|\[…\]|\[\.\.\.\]|…)\s*$", "", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return (cut[: end + 1] if end > limit * 0.5 else cut.rsplit(" ", 1)[0] + "…").strip()


def first_sentences(text: str, count: int = 2, limit: int = 320) -> str:
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9“\"])", text)
    joined = " ".join(sentences[:count]).strip()
    return clean_text(joined, limit)


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed:
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, IndexError):
        pass
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def canonical_url(url: str) -> str:
    """Drop tracking parameters and fragments so the same article from two feeds matches."""
    try:
        parts = urllib.parse.urlsplit(url.strip())
    except ValueError:
        return url.strip()
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query) if not re.match(r"^(utm_|ref$|source$|guccounter|fbclid|gclid)", k)]
    path = parts.path.rstrip("/") or "/"
    return urllib.parse.urlunsplit((parts.scheme.lower() or "https", parts.netloc.lower().removeprefix("www."), path, urllib.parse.urlencode(query), ""))


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child_text(element, *names: str) -> str:
    for child in element:
        if local_name(child.tag) in names and (child.text or "").strip():
            return child.text.strip()
    return ""


def parse_feed(body: bytes, source: dict) -> list[dict]:
    root = ET.fromstring(body)
    items = []
    entries = [e for e in root.iter() if local_name(e.tag) in ("item", "entry")]
    for entry in entries[:40]:
        title = clean_text(child_text(entry, "title"), 220)
        link = ""
        for child in entry:
            if local_name(child.tag) == "link":
                href = child.get("href")
                rel = child.get("rel", "alternate")
                if href and rel == "alternate":
                    link = href
                    break
                if not href and (child.text or "").strip():
                    link = child.text.strip()
                    break
        if not link:
            guid = child_text(entry, "guid", "id")
            link = guid if guid.startswith("http") else ""
        summary = child_text(entry, "description", "summary") or child_text(entry, "encoded", "content")
        published = parse_date(child_text(entry, "pubdate", "published", "updated", "date"))
        if not title or not link:
            continue
        items.append({
            "title": title,
            "url": link.strip(),
            "summary": clean_text(summary, 600),
            "published": published,
            "source": source["name"],
            "kind": source["kind"],
            "weight": source["weight"],
            "ai_only": source["ai_only"],
            "votes": 0,
        })
    return items


def fetch_source(source: dict) -> tuple[str, list[dict], str]:
    try:
        return source["name"], parse_feed(fetch(source["url"]), source), ""
    except Exception as error:  # one broken feed never stops the edition
        return source["name"], [], f"{type(error).__name__}: {error}"[:160]


def fetch_hacker_news(since: datetime) -> tuple[str, list[dict], str]:
    stories: dict[str, dict] = {}
    errors = []
    for query in HN_QUERIES:
        params = urllib.parse.urlencode({
            "tags": "story",
            "query": query,
            "hitsPerPage": 40,
            "numericFilters": f"created_at_i>{int(since.timestamp())},points>={HN_MIN_POINTS}",
        })
        try:
            hits = json.loads(fetch(f"https://hn.algolia.com/api/v1/search?{params}"))["hits"]
        except Exception as error:
            errors.append(f"{query}: {type(error).__name__}")
            continue
        for hit in hits:
            title = clean_text(hit.get("title"), 220)
            if not title or not AI_TERMS.search(title):
                continue
            discussion = f"https://news.ycombinator.com/item?id={hit['objectID']}"
            stories[hit["objectID"]] = {
                "title": title,
                "url": hit.get("url") or discussion,
                "summary": clean_text(hit.get("story_text"), 400),
                "published": datetime.fromtimestamp(hit["created_at_i"], timezone.utc),
                "source": "Hacker News",
                "kind": "community",
                "weight": 1.0,
                "ai_only": True,
                "votes": int(hit.get("points") or 0),
                "comments": int(hit.get("num_comments") or 0),
                "discussion": discussion,
            }
    error_text = "; ".join(errors) if len(errors) == len(HN_QUERIES) else ""
    return "Hacker News", list(stories.values()), error_text


def fetch_hf_papers() -> tuple[str, list[dict], str]:
    try:
        papers = json.loads(fetch(HF_PAPERS_URL))
    except Exception as error:
        return "Hugging Face Papers", [], f"{type(error).__name__}: {error}"[:160]
    items = []
    for entry in papers[:30]:
        paper = entry.get("paper") or {}
        upvotes = int(paper.get("upvotes") or entry.get("upvotes") or 0)
        if not paper.get("id") or upvotes < 15:
            continue
        items.append({
            "title": clean_text(paper.get("title") or entry.get("title"), 220),
            "url": f"https://huggingface.co/papers/{paper['id']}",
            "summary": clean_text(paper.get("ai_summary") or paper.get("summary"), 600),
            "published": parse_date(entry.get("publishedAt") or paper.get("publishedAt")),
            "source": "Hugging Face Papers",
            "kind": "research",
            "weight": 1.4,
            "ai_only": True,
            "votes": upvotes,
            "topic_hint": "research",
        })
    return "Hugging Face Papers", items, ""


# ----------------------------------------------------------------------------------------------
# Grouping, ranking, topics
# ----------------------------------------------------------------------------------------------
def title_tokens(title: str) -> set[str]:
    words = re.findall(r"[a-z0-9][a-z0-9.\-+']*", title.lower())
    tokens = set()
    for word in words:
        word = word.strip(".'-")
        if len(word) < 2 or word in STOPWORDS:
            continue
        if len(word) > 4 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        tokens.add(word)
    return tokens


DISTINCTIVE = re.compile(r"\d|^[a-z]+-[a-z0-9]+$")  # product names like gpt-6, claude-4.5, o3-mini


def same_story(a: set[str], b: set[str]) -> bool:
    if not a or not b:
        return False
    shared_tokens = a & b
    shared = len(shared_tokens)
    union = len(a | b)
    smaller = min(len(a), len(b))
    if shared / union >= 0.5 or (shared >= 4 and shared / smaller >= 0.6):
        return True
    # "Introducing GPT-6" (official post) and "OpenAI launches GPT-6 ..." (coverage) are one story.
    return any(DISTINCTIVE.search(t) and len(t) >= 4 for t in shared_tokens) and shared / smaller >= 0.5


def is_ai_story(item: dict) -> bool:
    return item["ai_only"] or bool(AI_TERMS.search(item["title"])) or bool(AI_TERMS.search(item["summary"][:300]))


def pick_topic(text: str, hint: str | None = None) -> str:
    if hint:
        return hint
    for topic_id, pattern in TOPIC_PATTERNS:
        if pattern.search(text):
            return topic_id
    return "tools"


def story_id(url: str) -> str:
    return hashlib.sha1(canonical_url(url).encode("utf-8")).hexdigest()[:12]


def group_stories(items: list[dict]) -> list[dict]:
    """One story per real-world event: same canonical URL or near-identical headline."""
    clusters: list[dict] = []
    by_url: dict[str, dict] = {}
    for item in sorted(items, key=lambda i: (-i["weight"], -(i["votes"] or 0))):
        key = canonical_url(item["url"])
        tokens = title_tokens(item["title"])
        cluster = by_url.get(key)
        if cluster is None:
            cluster = next((c for c in clusters if same_story(tokens, c["tokens"])), None)
        if cluster is None:
            cluster = {"items": [], "tokens": set(tokens)}
            clusters.append(cluster)
        cluster["items"].append(item)
        by_url[key] = cluster
    return clusters


def score_cluster(cluster: dict, now: datetime) -> float:
    items = cluster["items"]
    outlets = {i["source"] for i in items}
    best_weight = max(i["weight"] for i in items)
    coverage = sum(sorted((i["weight"] for i in items), reverse=True)[1:6]) * 0.6
    votes = sum(i["votes"] for i in items)
    community = math.log10(1 + votes) * 0.95
    newest = max((i["published"] for i in items if i["published"]), default=now - timedelta(hours=24))
    age_hours = max(0.0, (now - newest).total_seconds() / 3600)
    freshness = math.exp(-age_hours / 30)
    lab_bonus = 0.8 if any(i["kind"] == "lab" for i in items) and len(outlets) > 1 else 0.0
    return round((best_weight + coverage + community + lab_bonus) * (0.35 + 0.65 * freshness), 3)


def build_story(cluster: dict, now: datetime, previous: dict) -> dict:
    items = sorted(cluster["items"], key=lambda i: (-i["weight"], -len(i["summary"])))
    lead = next((i for i in items if i["kind"] in ("lab", "news") and i["source"] != "Hacker News"), items[0])
    sid = story_id(lead["url"])
    old = previous.get(sid) or {}
    summary_source = max((i["summary"] for i in items), key=len, default="")
    published_times = [i["published"] for i in items if i["published"]]
    published = min(published_times) if published_times else now
    sources, seen = [], set()
    for item in items:
        if item["source"] in seen:
            continue
        seen.add(item["source"])
        sources.append({"name": item["source"], "url": item["url"], "kind": item["kind"]})
    hn = next((i for i in items if i.get("discussion")), None)
    votes = sum(i["votes"] for i in items)
    topic_text = " ".join([lead["title"], lead["summary"][:300]])
    story = {
        "id": sid,
        "title": lead["title"],
        "url": lead["url"],
        "source": lead["source"],
        "sources": sources[:8],
        "published": published.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "first_seen": old.get("first_seen") or now.isoformat(timespec="seconds"),
        "topic": pick_topic(topic_text, next((i.get("topic_hint") for i in items if i.get("topic_hint")), None)),
        "summary": old.get("summary") if old.get("summary_ai") else first_sentences(summary_source, 2, 320),
        "summary_ai": bool(old.get("summary_ai")),
        "why": old.get("why", ""),
        "score": score_cluster(cluster, now),
    }
    if votes:
        story["votes"] = votes
    if hn:
        story["discussion"] = hn["discussion"]
        story["comments"] = hn.get("comments", 0)
    return story


META_DESCRIPTION = re.compile(
    r"<meta[^>]+(?:property|name)=[\"'](?:og:description|twitter:description|description)[\"'][^>]*>",
    re.I,
)
META_CONTENT = re.compile(r"content=[\"']([^\"']{40,})[\"']", re.I)


def page_description(url: str) -> str:
    """The article's own one-paragraph description (og:description / meta description)."""
    if not url.startswith("https://") or "news.ycombinator.com" in url:
        return ""
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
        with urllib.request.urlopen(request, timeout=10) as response:
            if "html" not in (response.headers.get("Content-Type") or ""):
                return ""
            head = response.read(400_000).decode("utf-8", "replace")
    except Exception:
        return ""
    for tag in META_DESCRIPTION.findall(head):
        found = META_CONTENT.search(tag)
        if found:
            return clean_text(found.group(1), 400)
    return ""


def fill_missing_summaries(stories: list[dict], log) -> None:
    thin = [s for s in stories[:AI_SUMMARY_COUNT] if len(s["summary"]) < 80 and not s["summary_ai"]]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for story, description in zip(thin, pool.map(lambda s: page_description(s["url"]), thin)):
            if len(description) > len(story["summary"]):
                story["summary"] = first_sentences(description, 2, 320)
    log(f"  page descriptions: {sum(1 for s in thin if len(s['summary']) >= 80)}/{len(thin)} thin stories filled")


# ----------------------------------------------------------------------------------------------
# Free AI pass (best effort): summaries, why it matters, the briefing
# ----------------------------------------------------------------------------------------------
_provider_rest: dict[str, float] = {}
_ai_deadline = [0.0]


def ask_ai(prompt: str, timeout: int = 60) -> str:
    """One answer from the first free AI that responds. Raises when every one is busy or down."""
    messages = [
        {"role": "system", "content": "You are Glow News, a careful AI-industry news editor. Use ONLY the facts given. Never invent numbers, names, dates or quotes. Plain English, no hype. Reply with JSON only, no other text."},
        {"role": "user", "content": prompt},
    ]
    errors = []
    for name, base, model in AI_PROVIDERS:
        if _ai_deadline[0] and time.time() > _ai_deadline[0]:
            errors.append("time budget used up")
            break
        if _provider_rest.get(name, 0) > time.time():
            continue
        body = json.dumps({"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 2500}).encode("utf-8")
        try:
            raw = fetch(f"{base}/chat/completions", timeout=timeout, data=body, headers={"Content-Type": "application/json"})
            content = json.loads(raw)["choices"][0]["message"]["content"] or ""
            if content.strip():
                return content
            errors.append(f"{name}: empty reply")
        except Exception as error:
            errors.append(f"{name}: {type(error).__name__} {getattr(error, 'code', '')}".strip())
            _provider_rest[name] = time.time() + 65  # rate limit windows are a minute
    raise RuntimeError("no free AI answered (" + "; ".join(errors) + ")")


def parse_json_reply(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start : end + 1]) if start >= 0 and end > start else {}


def ai_enrich(stories: list[dict], log) -> dict:
    """Adds AI summaries to stories that don't have one yet, and writes the briefing. Never raises."""
    _ai_deadline[0] = time.time() + AI_TIME_BUDGET
    # Only stories with real text: a headline alone gives the AI nothing true to add.
    todo = [s for s in stories[:AI_SUMMARY_COUNT] if not s["summary_ai"] and len(s["summary"]) >= 80]
    for start in range(0, len(todo), 10):
        batch = todo[start : start + 10]
        listing = "\n\n".join(
            f"[{s['id']}] {s['title']}\nSources: {', '.join(x['name'] for x in s['sources'])}\nText: {s['summary'] or '(headline only)'}"
            for s in batch
        )
        prompt = (
            "For each story below write:\n"
            '- "summary": 2 factual sentences (30-50 words) using only the text given: who did what, and the key detail or number.\n'
            '- "why": one concrete sentence (15-28 words) on the real consequence for people who use, build or invest in AI. '
            'Name the specific effect (cost, capability, competition, rules, jobs, safety). '
            'Bad: "Matters for AI users." Good: "Open weights let companies run a frontier-class model on their own servers instead of paying per token." '
            'If you cannot say something specific, return "" for why.\n'
            'Reply as JSON: {"stories": {"<id>": {"summary": "...", "why": "..."}}}\n\n' + listing
        )
        try:
            answers = parse_json_reply(ask_ai(prompt)).get("stories", {})
        except Exception as error:
            log(f"AI summaries skipped for a batch: {type(error).__name__}: {error}")
            continue
        for story in batch:
            answer = answers.get(story["id"]) or {}
            summary = clean_text(str(answer.get("summary") or ""), 360)
            why = clean_text(str(answer.get("why") or ""), 200)
            if len(summary) >= 60 and "sources include" not in summary.lower():
                story["summary"] = summary
                story["summary_ai"] = True
            vague = re.match(r"^(it )?(matters|affects|impacts|improves|enhances|important)\b", why, re.I)
            if len(why) >= 45 and not vague:
                story["why"] = why
    return ai_briefing(stories, log)


def ai_briefing(stories: list[dict], log) -> dict:
    briefing = {}
    top = stories[:12]
    listing = "\n".join(f"[{s['id']}] {s['title']} — {s['summary']}" for s in top)
    prompt = (
        "Write today's AI briefing from these top stories. "
        "headline: a specific one-line title for this edition naming the biggest story (6-12 words, not 'AI News Today'). "
        "points: the 5 most important developments, each ONE full informative sentence of 18-30 words that says what happened "
        "and why it matters, with the story id it comes from. Use only the facts given.\n"
        'Reply as JSON: {"headline": "...", "points": [{"text": "...", "id": "<story id>"}]}\n\n' + listing
    )
    try:
        reply = parse_json_reply(ask_ai(prompt))
        ids = {s["id"] for s in top}
        points = [
            {"text": clean_text(str(p.get("text") or ""), 240), "id": str(p.get("id") or "")}
            for p in reply.get("points", [])
            if isinstance(p, dict) and str(p.get("id") or "") in ids and len(str(p.get("text") or "")) >= 40
        ][:5]
        headline = clean_text(str(reply.get("headline") or ""), 120)
        if headline.lower().strip(" .!") in ("ai news today", "today's ai news", "ai news"):
            headline = ""
        if len(points) >= 3:
            briefing = {"headline": headline, "points": points, "ai": True}
        else:
            log(f"AI briefing rejected: {len(points)} usable points in {str(reply)[:300]}")
    except Exception as error:
        log(f"AI briefing skipped: {type(error).__name__}: {error}")
    return briefing


def plain_briefing(stories: list[dict]) -> dict:
    """No AI available: the briefing is simply the five top headlines."""
    return {"headline": "", "points": [{"text": s["title"], "id": s["id"]} for s in stories[:5]], "ai": False}


# ----------------------------------------------------------------------------------------------
# Editions
# ----------------------------------------------------------------------------------------------
def latest_slot(now: datetime) -> datetime:
    return now.replace(hour=(now.hour // REFRESH_HOURS) * REFRESH_HOURS, minute=0, second=0, microsecond=0)


def load_previous(path: Path, live_url: str | None, log) -> dict:
    if live_url:
        try:
            data = json.loads(fetch(live_url, timeout=20))
            if data.get("stories"):
                return data
        except Exception as error:
            log(f"live copy unavailable ({type(error).__name__}); using the committed copy")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def build_edition(now: datetime, previous: dict, use_ai: bool, log) -> dict:
    since = now - timedelta(hours=WINDOW_HOURS)
    jobs = [lambda s=s: fetch_source(s) for s in SOURCES] + [lambda: fetch_hacker_news(since), fetch_hf_papers]
    items, status = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for name, found, error in pool.map(lambda job: job(), jobs):
            status.append({"name": name, "ok": not error, "items": len(found)})
            if error:
                log(f"  {name}: skipped ({error})")
            items.extend(found)
    items = [i for i in items if is_ai_story(i)]
    recent = [i for i in items if (i["published"] or now) >= since]
    if len(recent) < 25:  # quiet spell or feeds without dates: widen to a week
        recent = [i for i in items if (i["published"] or now) >= now - timedelta(days=7)]
    previous_by_id = {s["id"]: s for s in previous.get("stories", [])}
    clusters = group_stories(recent)
    stories = sorted((build_story(c, now, previous_by_id) for c in clusters), key=lambda s: -s["score"])
    # Keep the page varied: at most 4 of the top 20 from one lead source.
    picked, per_source = [], {}
    for story in stories:
        count = per_source.get(story["source"], 0)
        if len(picked) < 20 and count >= 4:
            continue
        per_source[story["source"]] = count + 1
        picked.append(story)
        if len(picked) >= MAX_STORIES:
            break
    fill_missing_summaries(picked, log)
    briefing = ai_enrich(picked, log) if use_ai else {}
    if not briefing:
        briefing = plain_briefing(picked)
    next_slot = latest_slot(now) + timedelta(hours=REFRESH_HOURS)
    return {
        "version": 1,
        "generated_at": now.isoformat(timespec="seconds"),
        "next_update": next_slot.isoformat(timespec="seconds"),
        "refresh_hours": REFRESH_HOURS,
        "topics": [{"id": t, "label": label} for t, label, _ in TOPICS],
        "briefing": briefing,
        "stories": picked,
        "sources": sorted(status, key=lambda s: s["name"]),
    }


def validate(edition: dict) -> list[str]:
    problems = []
    if not isinstance(edition.get("stories"), list) or len(edition["stories"]) < 5:
        problems.append("fewer than 5 stories")
    ids = [s.get("id") for s in edition.get("stories", [])]
    if len(ids) != len(set(ids)):
        problems.append("duplicate story ids")
    for story in edition.get("stories", []):
        if not str(story.get("url", "")).startswith(("https://", "http://")):
            problems.append(f"bad url in {story.get('id')}")
        if story.get("topic") not in TOPIC_LABELS:
            problems.append(f"unknown topic in {story.get('id')}")
    return problems


def selftest() -> int:
    now = datetime(2026, 10, 30, 6, 0, tzinfo=timezone.utc)
    base = {"summary": "", "kind": "news", "weight": 2.0, "ai_only": True, "votes": 0}
    items = [
        {**base, "title": "OpenAI launches GPT-6 with new reasoning mode", "url": "https://techcrunch.com/a?utm_source=x", "source": "TechCrunch", "published": now - timedelta(hours=2)},
        {**base, "title": "OpenAI launches GPT-6 with a new reasoning mode for developers", "url": "https://theverge.com/b", "source": "The Verge", "published": now - timedelta(hours=3)},
        {**base, "title": "Introducing GPT-6", "url": "https://openai.com/index/gpt-6/", "source": "OpenAI", "kind": "lab", "weight": 3.0, "published": now - timedelta(hours=4)},
        {**base, "title": "EU fines startup under the AI Act", "url": "https://wired.com/c", "source": "Wired", "published": now - timedelta(hours=30)},
        {**base, "title": "OpenAI launches GPT-6 with new reasoning mode", "url": "https://www.techcrunch.com/a/", "source": "TechCrunch", "published": now - timedelta(hours=2)},
    ]
    failures = []
    clusters = group_stories(items)
    if len(clusters) != 2:
        failures.append(f"expected 2 groups (all GPT-6 coverage incl. the official post, and the EU story), got {len(clusters)}")
    if same_story(title_tokens("OpenAI launches GPT-5"), title_tokens("Researchers find a GPT-5 jailbreak in minutes")):
        failures.append("a different story that only shares a model name must stay separate")
    if canonical_url("https://www.techcrunch.com/a/?utm_source=x#top") != canonical_url("https://techcrunch.com/a"):
        failures.append("canonical_url does not drop www, utm and trailing slash")
    stories = sorted((build_story(c, now, {}) for c in clusters), key=lambda s: -s["score"])
    if "GPT-6" not in stories[0]["title"]:
        failures.append("the widely covered story should rank first")
    if pick_topic("EU fines startup under the AI Act") != "policy":
        failures.append("AI Act story should be Policy & safety")
    if pick_topic("Startup raises $200 million for AI chips") != "business":
        failures.append("funding story should be Business")
    if pick_topic("Trump declares robot imports a national security threat") != "policy":
        failures.append("trade / national security story should be Policy & safety")
    if pick_topic("Microsoft's AI future has fewer jobs") != "business":
        failures.append("jobs story should be Business")
    if latest_slot(datetime(2026, 10, 30, 13, 5, tzinfo=timezone.utc)).hour != 12:
        failures.append("13:05 UTC should belong to the 12:00 slot")
    if clean_text("<p>Hello &amp; welcome</p><p>The post X appeared first on Y.</p>") != "Hello & welcome":
        failures.append("clean_text should strip tags, entities and 'The post … appeared first'")
    for failure in failures:
        print("FAIL", failure)
    print("selftest", "FAILED" if failures else "PASSED")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=OUT_FILE)
    parser.add_argument("--ai", action="store_true", help="add free AI summaries and the briefing (best effort)")
    parser.add_argument("--live", help="URL of the live news.json; reused when it is from the current half-day slot")
    parser.add_argument("--force", action="store_true", help="build a new edition even if the live one is current")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        return selftest()

    log = lambda message: print(message, file=sys.stderr, flush=True)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    previous = load_previous(args.out, args.live, log)
    generated = parse_date(previous.get("generated_at"))
    if not args.force and generated and generated >= latest_slot(now) and not validate(previous):
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(previous, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        log(f"Edition from {previous['generated_at']} is current (next at {previous.get('next_update')}); reused it.")
        return 0

    started = time.time()
    edition = build_edition(now, previous, args.ai, log)
    problems = validate(edition)
    if problems:
        log("New edition rejected, keeping the previous one: " + "; ".join(problems))
        return 2
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(edition, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ok = sum(1 for s in edition["sources"] if s["ok"])
    ai_count = sum(1 for s in edition["stories"] if s["summary_ai"])
    log(f"Wrote {len(edition['stories'])} stories from {ok}/{len(edition['sources'])} sources "
        f"({ai_count} AI summaries, briefing {'AI' if edition['briefing'].get('ai') else 'headlines'}) in {time.time() - started:.0f}s -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
