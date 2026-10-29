#!/usr/bin/env python3
"""Collect what Indonesia is talking about right now, for topic planning.

Sources (all public RSS, stdlib only):
  * Google Trends daily search trends for Indonesia (with linked news items)
  * Tech-news section feeds from Indonesian publishers (configurable)

Output: a JSON brief with trending searches, recent tech headlines (title, link,
date, source) and a shortlist ranked for this channel's angle (prices, gadgets,
shopping, spending). The planner feeds this brief to the script writer, which must
cite the linked articles; nothing here is treated as a verified fact on its own.

Usage:  python trends.py [--out trends.json] [--days 7]
"""

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree

TRENDS_URL = "https://trends.google.com/trending/rss?geo=ID"
TRENDS_NS = {"ht": "https://trends.google.com/trending/rss"}
NEWS_FEEDS = {
    "CNN Indonesia Teknologi": "https://www.cnnindonesia.com/teknologi/rss",
    "Antara Tekno": "https://www.antaranews.com/rss/tekno.xml",
}
# words that make a story useful for a "should you buy it / why we justify it" channel
ANGLE_WORDS = {
    "harga": 3, "rp": 2, "juta": 2, "diskon": 3, "promo": 2, "flash sale": 3, "11.11": 3, "12.12": 3,
    "harbolnas": 3, "cicilan": 3, "paylater": 3, "kredit": 2, "pre-order": 2, "preorder": 2, "ludes": 2,
    "habis": 1, "iphone": 2, "samsung": 2, "xiaomi": 1, "oppo": 1, "vivo": 1, "hp": 1, "ponsel": 2,
    "smartphone": 2, "laptop": 2, "gadget": 2, "konsol": 2, "playstation": 2, "rilis": 1, "resmi": 1,
    "spesifikasi": 1, "baterai": 1, "power bank": 2, "langganan": 2, "tarif": 2, "naik": 1, "mahal": 2,
    "murah": 2, "belanja": 3, "shopee": 2, "tokopedia": 2, "tiktok shop": 2, "lazada": 2,
}
USER_AGENT = "Mozilla/5.0 (Hazel Shorts trend brief; +https://juw12.github.io/projects/hazel/shorts/)"


def fetch(url, timeout=20):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def parse_date(text):
    try:
        return parsedate_to_datetime(text).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def clean(text):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def angle_score(text):
    lowered = text.lower()
    return sum(weight for word, weight in ANGLE_WORDS.items() if word in lowered)


def google_trends():
    root = ElementTree.fromstring(fetch(TRENDS_URL))
    trends = []
    for item in root.iter("item"):
        news = []
        for news_item in item.findall("ht:news_item", TRENDS_NS):
            news.append({
                "title": clean(news_item.findtext("ht:news_item_title", default="", namespaces=TRENDS_NS)),
                "url": news_item.findtext("ht:news_item_url", default="", namespaces=TRENDS_NS),
                "source": news_item.findtext("ht:news_item_source", default="", namespaces=TRENDS_NS),
            })
        trends.append({
            "query": clean(item.findtext("title")),
            "traffic": item.findtext("ht:approx_traffic", default="", namespaces=TRENDS_NS),
            "date": (parse_date(item.findtext("pubDate")) or datetime.now(timezone.utc)).isoformat(),
            "news": news,
        })
    return trends


def news_headlines(since):
    headlines = []
    for source, url in NEWS_FEEDS.items():
        try:
            root = ElementTree.fromstring(fetch(url))
        except Exception as err:  # one broken feed must not stop the brief
            print(f"warning: {source}: {err}", file=sys.stderr)
            continue
        for item in root.iter("item"):
            published = parse_date(item.findtext("pubDate"))
            if published and published < since:
                continue
            title = clean(item.findtext("title"))
            headlines.append({
                "title": title,
                "url": (item.findtext("link") or "").strip(),
                "date": published.isoformat() if published else None,
                "source": source,
                "summary": clean(item.findtext("description"))[:280],
            })
    return headlines


def build_brief(days=7):
    now = datetime.now(timezone.utc)
    trends = []
    try:
        trends = google_trends()
    except Exception as err:
        print(f"warning: Google Trends: {err}", file=sys.stderr)
    headlines = news_headlines(now - timedelta(days=days))

    candidates = []
    for trend in trends:
        text = " ".join([trend["query"]] + [n["title"] for n in trend["news"]])
        candidates.append({"kind": "search-trend", "title": trend["query"], "score": angle_score(text) + 2,
                           "traffic": trend["traffic"], "evidence": trend["news"][:3]})
    for headline in headlines:
        candidates.append({"kind": "news", "title": headline["title"], "score": angle_score(headline["title"] + " " + headline["summary"]),
                           "evidence": [{"title": headline["title"], "url": headline["url"], "source": headline["source"]}],
                           "date": headline["date"]})
    shortlist = sorted((c for c in candidates if c["score"] >= 3), key=lambda c: -c["score"])[:25]
    return {
        "generated": now.isoformat(timespec="seconds"),
        "window_days": days,
        "shortlist": shortlist,
        "search_trends": trends,
        "headlines": headlines,
        "note": "Headlines are leads, not facts. Every number used in a script must be checked against the linked article.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="trends.json")
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()
    brief = build_brief(args.days)
    Path(args.out).write_text(json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(brief['search_trends'])} search trends, {len(brief['headlines'])} headlines, "
          f"{len(brief['shortlist'])} shortlisted -> {args.out}")
    for item in brief["shortlist"][:10]:
        print(f"  [{item['score']:>2}] {item['kind']:<12} {item['title'][:90]}")


if __name__ == "__main__":
    main()
