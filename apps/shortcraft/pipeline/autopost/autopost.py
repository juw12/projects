#!/usr/bin/env python3
"""Shortcraft autopost — plan → render → post on a daily schedule, per channel.

Queue layout (one folder per video):
    queue/<channel>/<NNN-slug>/project.json   Shortcraft project (from the studio or `plan`)
                               video.mp4      rendered by `render`
                               post.json      title / caption / tags + "approved": true|false
                               result.json    what was posted where (written by `run`)

Commands:
    autopost.py auth youtube|tiktok --channel en      one-time consent (opens the browser)
    autopost.py plan --channel en --topics topics.txt [--llm]   create queue items
    autopost.py render [--channel en]                 render items that have no video yet
    autopost.py run [--dry-run]                       post due items (call every 15 min)
    autopost.py status                                show queue + today's slots

Safety: items are only posted when post.json has "approved": true (review facts first),
unless the channel sets "auto_approve": true. Each platform is posted once per item.
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from platforms import CLIENTS, PlatformError, load_json, save_json  # noqa: E402

HERE = Path(__file__).resolve().parent
HASHTAGS = {
    "en": ["engineering", "howitworks", "explained", "science", "tech", "shorts"],
    "id": ["faktaunik", "teknik", "engineering", "edukasi", "sains", "fyp"],
}


def load_config(path):
    cfg = load_json(path)
    if not cfg:
        sys.exit(f"Config not found: {path} (copy config.example.json)")
    # relative paths (queue/, tokens/, secrets/) are relative to the config file,
    # so cron/launchd can call this script from any working directory
    os.chdir(Path(path).resolve().parent)
    return cfg


def channel_dir(cfg, name):
    return Path(cfg.get("queue_dir", HERE / "queue")) / name


def now_local(cfg):
    offset = float(cfg.get("utc_offset_hours", 7))
    return datetime.now(timezone(timedelta(hours=offset)))


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "video"


def post_meta(project):
    lang = project.get("lang", "en")
    scenes = project.get("scenes", [])
    hook = scenes[0].get("narration", "") if scenes else ""
    bullets = [f"• {s.get('headline', '')}" + (f" — {s['stat']}" if s.get("stat") else "") for s in scenes[1:-1]]
    outro = scenes[-1].get("narration", "") if len(scenes) > 1 else ""
    tags = HASHTAGS.get(lang, HASHTAGS["en"])
    caption = "\n".join([hook, *bullets, outro, "", " ".join("#" + t for t in tags)]).strip()
    return {
        "title": project.get("title", "Shortcraft"),
        "description": caption,
        "caption": caption,
        "tags": tags,
        "lang": lang,
        "approved": False,
    }


# ----------------------------------------------------------------------------- plan
SCHEMA_HINT = """Return ONLY JSON: {"title": str, "kicker": str, "template": "editorial"|"teardown",
"lang": "%s", "music": "calm"|"bright"|"dark", "captions": true,
"scenes": [{"headline": str, "sub": str?, "label": str?, "icon": one emoji, "stat": str?,
"statLabel": str?, "narration": str (1-2 short sentences, spoken), "caption": str?}]}
6-8 scenes: scene 1 = hook question, middle = steps with one concrete number each,
last = question CTA. Only state facts you are confident are true; prefer typical/approximate wording."""


def llm_project(topic, lang, cfg):
    llm = cfg.get("llm") or {}
    key = llm.get("api_key")
    if not key:
        sys.exit("No llm.api_key in config — write projects in the studio, or add an OpenAI-compatible key.")
    language = "Bahasa Indonesia" if lang == "id" else "English"
    body = {
        "model": llm.get("model", "gpt-4o-mini"),
        "messages": [
            {"role": "system", "content": "You write faceless 9:16 explainer short scripts. " + SCHEMA_HINT % lang},
            {"role": "user", "content": f"Topic: {topic}\nLanguage: {language}\nAudience: curious general public."},
        ],
        "temperature": 0.6,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        llm.get("base_url", "https://api.openai.com/v1").rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        content = json.loads(resp.read())["choices"][0]["message"]["content"]
    project = json.loads(content)
    if not 4 <= len(project.get("scenes", [])) <= 9:
        raise ValueError("LLM returned an invalid scene count")
    project["lang"] = lang
    return project


def cmd_plan(cfg, args):
    ch = next(c for c in cfg["channels"] if c["name"] == args.channel)
    topics = [t.strip() for t in Path(args.topics).read_text(encoding="utf-8").splitlines() if t.strip()]
    qdir = channel_dir(cfg, ch["name"])
    qdir.mkdir(parents=True, exist_ok=True)
    start = len([p for p in qdir.iterdir() if p.is_dir()])
    for i, topic in enumerate(topics):
        item = qdir / f"{start + i + 1:03d}-{slug(topic)}"
        item.mkdir(exist_ok=True)
        if args.llm:
            project = llm_project(topic, ch["lang"], cfg)
        else:
            project = {"title": topic, "kicker": ch.get("kicker", ""), "template": ch.get("template", "editorial"),
                       "lang": ch["lang"], "music": "calm", "captions": True,
                       "scenes": [{"headline": topic, "icon": "❓", "narration": "TODO: hook"},
                                  {"headline": "Step 1", "icon": "💡", "narration": "TODO"},
                                  {"headline": "Step 2", "icon": "⚙️", "narration": "TODO"},
                                  {"headline": "What next?", "icon": "💬", "narration": "TODO: question"}]}
        save_json(item / "project.json", project)
        save_json(item / "post.json", post_meta(project))
        print(f"planned {item}")
    print("Review each project.json (open it in the studio via Import JSON), then set \"approved\": true in post.json.")


# ----------------------------------------------------------------------------- render
def cmd_render(cfg, args):
    from render_headless import render  # heavy deps only when rendering
    for ch in cfg["channels"]:
        if args.channel and ch["name"] != args.channel:
            continue
        for item in sorted(channel_dir(cfg, ch["name"]).glob("*/project.json")):
            video = item.parent / "video.mp4"
            if video.exists():
                continue
            print(f"rendering {item.parent.name} …", flush=True)
            info = render(item, video)
            meta = load_json(item.parent / "post.json") or post_meta(load_json(item))
            meta["seconds"] = info["seconds"]
            save_json(item.parent / "post.json", meta)
            print(f"  -> {video} ({info['seconds']} s)")


# ----------------------------------------------------------------------------- run
def due_slots(cfg, ch):
    now = now_local(cfg)
    slots = []
    for hhmm in ch.get("slots", ["09:00", "13:00", "19:00"]):
        h, m = map(int, hhmm.split(":"))
        at = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if at <= now:
            slots.append(at)
    return slots


def posted_today(cfg, ch):
    today = now_local(cfg).date().isoformat()
    count = 0
    for res in channel_dir(cfg, ch["name"]).glob("*/result.json"):
        data = load_json(res) or {}
        if data.get("date") == today and data.get("complete"):
            count += 1
    return count


def next_item(cfg, ch):
    for item in sorted(channel_dir(cfg, ch["name"]).iterdir() if channel_dir(cfg, ch["name"]).exists() else []):
        if not item.is_dir() or not (item / "video.mp4").exists():
            continue
        result = load_json(item / "result.json") or {}
        if result.get("complete"):
            continue
        meta = load_json(item / "post.json") or {}
        if meta.get("approved") or ch.get("auto_approve"):
            return item, meta, result
    return None, None, None


def cmd_run(cfg, args):
    tokens = Path(cfg.get("token_dir", HERE / "tokens"))
    for ch in cfg["channels"]:
        due = len(due_slots(cfg, ch))
        done = posted_today(cfg, ch)
        if due <= done:
            print(f"[{ch['name']}] nothing due ({done}/{due} slots filled today)")
            continue
        item, meta, result = next_item(cfg, ch)
        if not item:
            print(f"[{ch['name']}] slot due but no approved, rendered video in the queue")
            continue
        print(f"[{ch['name']}] posting {item.name}")
        result.setdefault("platforms", {})
        ok = True
        for platform, pcfg in ch.get("platforms", {}).items():
            if not pcfg.get("enabled", True) or result["platforms"].get(platform, {}).get("ok"):
                continue
            client = CLIENTS[platform](pcfg, tokens / f"{ch['name']}-{platform}.json")
            try:
                out = client.post(str(item / "video.mp4"), meta, dry_run=args.dry_run)
                result["platforms"][platform] = {"ok": True, **out}
                print(f"  {platform}: ok {out.get('url') or out.get('id') or out.get('publish_id') or ''}")
            except (PlatformError, KeyError, OSError) as err:
                ok = False
                result["platforms"][platform] = {"ok": False, "error": str(err)[:500]}
                print(f"  {platform}: FAILED {err}")
        if args.dry_run:
            print("  (dry run — nothing recorded)")
            continue
        result.update({"date": now_local(cfg).date().isoformat(), "complete": ok,
                       "at": now_local(cfg).isoformat(timespec="minutes")})
        save_json(item / "result.json", result)


def cmd_auth(cfg, args):
    ch = next(c for c in cfg["channels"] if c["name"] == args.channel)
    pcfg = ch["platforms"][args.platform]
    tokens = Path(cfg.get("token_dir", HERE / "tokens"))
    client = CLIENTS[args.platform](pcfg, tokens / f"{ch['name']}-{args.platform}.json")
    if args.platform == "instagram":
        client.refresh()
        print("Instagram token refreshed")
    else:
        client.authorize()


def cmd_status(cfg, args):
    for ch in cfg["channels"]:
        qdir = channel_dir(cfg, ch["name"])
        items = sorted(p for p in qdir.iterdir() if p.is_dir()) if qdir.exists() else []
        ready = [p for p in items if (p / "video.mp4").exists()]
        approved = [p for p in ready if (load_json(p / "post.json") or {}).get("approved")]
        posted = [p for p in items if (load_json(p / "result.json") or {}).get("complete")]
        print(f"[{ch['name']}] queue {len(items)} · rendered {len(ready)} · approved {len(approved)} · posted {len(posted)}"
              f" · today {posted_today(cfg, ch)}/{len(ch.get('slots', []))} slots · platforms "
              f"{', '.join(k for k, v in ch.get('platforms', {}).items() if v.get('enabled', True))}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default=str(HERE / "config.json"))
    sub = parser.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("auth")
    a.add_argument("platform", choices=["youtube", "tiktok", "instagram"])
    a.add_argument("--channel", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--channel", required=True)
    p.add_argument("--topics", required=True)
    p.add_argument("--llm", action="store_true")
    r = sub.add_parser("render")
    r.add_argument("--channel")
    u = sub.add_parser("run")
    u.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    args = parser.parse_args()
    cfg = load_config(args.config)
    {"auth": cmd_auth, "plan": cmd_plan, "render": cmd_render, "run": cmd_run, "status": cmd_status}[args.cmd](cfg, args)


if __name__ == "__main__":
    main()
