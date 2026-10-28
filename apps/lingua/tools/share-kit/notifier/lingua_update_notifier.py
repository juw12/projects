"""Lingua update notifier.

Polls the GitHub releases of Lingua. When a release newer than the last one announced is fully
published (zip uploaded and settled), it builds an update deck (how to update, what's new,
version history, full usage guide) and replies-all in the original Outlook thread.

Usage:
    python lingua_update_notifier.py                 # normal run (scheduled task)
    python lingua_update_notifier.py --status        # show what it would do, no e-mail
    python lingua_update_notifier.py --dry-run [--pretend-last 2.2.2]
                                                     # build deck + reply, save a .msg preview, never send
"""
import argparse
import datetime as dt
import html
import json
import logging
import re
import sys
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import lingua_deck  # noqa: E402

CONFIG_PATH = HERE / "config.json"
STATE_PATH = HERE / "state.json"
LOG_PATH = HERE / "notifier.log"
OUT_DIR = HERE / "out"
TAG_RE = re.compile(r"^lingua-v(\d+)\.(\d+)\.(\d+)$")

logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("lingua-notifier")


def say(message):
    log.info(message)
    try:
        print(message)
    except Exception:
        pass


def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def version_tuple(text):
    return tuple(int(part) for part in text.split("."))


# ------------------------------------------------------------- GitHub
def fetch_releases(config):
    session = requests.Session()
    session.trust_env = False
    if config.get("proxy"):
        session.proxies.update({"https": config["proxy"], "http": config["proxy"]})
    url = f"https://api.github.com/repos/{config['repo']}/releases?per_page=100"
    response = session.get(url, timeout=60, headers={"Accept": "application/vnd.github+json"})
    response.raise_for_status()
    releases = []
    for release in response.json():
        match = TAG_RE.match(release.get("tag_name", ""))
        if not match or release.get("draft") or release.get("prerelease"):
            continue
        asset = next(
            (a for a in release.get("assets", [])
             if a["name"].startswith("Lingua-windows") and a["name"].endswith(".zip")
             and a.get("state") == "uploaded" and a.get("size", 0) > 1_000_000),
            None,
        )
        published = dt.datetime.fromisoformat(release["published_at"].replace("Z", "+00:00"))
        releases.append({
            "version": ".".join(match.groups()),
            "name": release.get("name") or "",
            "body": release.get("body") or "",
            "published": published,
            "date": published.astimezone().strftime("%Y-%m-%d"),
            "html_url": release["html_url"],
            "download_url": asset["browser_download_url"] if asset else None,
        })
    releases.sort(key=lambda r: version_tuple(r["version"]), reverse=True)
    return releases


def clean(text):
    text = re.sub(r"[\U00010000-\U0010FFFF]", "", text)  # emoji the slide font can't draw
    text = text.replace("`", "")
    return re.sub(r"\s+", " ", text).strip()


def headline_of(release):
    name = release["name"]
    for separator in ("—", " - "):
        if separator in name:
            return clean(name.split(separator, 1)[1]).rstrip(".").capitalize()
    for line in release["body"].splitlines():
        line = line.strip()
        if "for Windows:" in line:
            text = clean(line.split("for Windows:", 1)[1].replace("**", ""))
            return (text[:1].upper() + text[1:]).rstrip(".")
    return f"Lingua {release['version']}"


def bullets_of(release):
    items = []
    for line in release["body"].splitlines():
        line = line.strip()
        if not line.startswith(("- ", "* ")):
            continue
        text = line[2:].strip()
        if re.search(r"sha-?256", text, re.I):
            continue
        match = re.match(r"\*\*(.+?)\*\*\s*(.*)", text)
        if match:
            head = clean(match.group(1))
            tail = clean(match.group(2).replace("**", ""))
            if tail.startswith(":"):
                head += ":"
                tail = tail[1:].strip()
            items.append((head + " ", tail))
        else:
            items.append(("", clean(text.replace("**", ""))))
    return items


def build_change_log(releases, previous_version, new_version):
    """Changes for versions in (previous, new], newest first, without bullets repeated from older notes."""
    seen = set()
    for release in releases:
        if version_tuple(release["version"]) <= version_tuple(previous_version):
            for head, tail in bullets_of(release):
                seen.add((head + tail).lower())
    selected = [r for r in releases
                if version_tuple(previous_version) < version_tuple(r["version"]) <= version_tuple(new_version)]
    changes = []
    for release in sorted(selected, key=lambda r: version_tuple(r["version"])):
        fresh = []
        for head, tail in bullets_of(release):
            key = (head + tail).lower()
            if key not in seen:
                seen.add(key)
                fresh.append((head, tail))
        changes.append((release["version"], release["date"], headline_of(release), fresh))
    changes.reverse()
    return changes


# ------------------------------------------------------------- e-mail
def email_html(new_release, previous_version, changes, history, deck_name, config):
    esc = html.escape
    parts = [
        '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:11pt;color:#1f2937">',
        f"<p>{esc(config.get('greeting', 'Hi all,'))}</p>",
        f"<p><b>Lingua {esc(new_release['version'])}</b> is out "
        f"(you were last sent {esc(previous_version)}). {esc(headline_of(new_release))}.</p>",
        '<p style="font-size:13pt;color:#0e86d4"><b>How to update (about 1 minute)</b></p>',
        "<ol>",
        "<li>Open Lingua and click <b>&#10227; Updates</b> (top right). Lingua also checks by itself on start and every 4 hours.</li>",
        f"<li>Click <b>Update to {esc(new_release['version'])}</b> &rarr; <b>Update now</b>. It downloads, verifies and restarts. "
        "Your settings, history and lingua.env are kept.</li>",
        "</ol>",
        f"<p>Not installed yet, or the button doesn't work? Download the zip: "
        f"<a href=\"{esc(new_release['download_url'])}\">{esc(new_release['download_url'])}</a> "
        "and follow the installation steps in the attached slides (lingua.env is in my first e-mail below).</p>",
        '<p style="font-size:13pt;color:#0e86d4"><b>What\'s new</b></p>',
    ]
    for version, date, headline, items in changes:
        parts.append(f"<p style=\"margin-bottom:2px\"><b>{esc(version)}</b> ({esc(date)}): {esc(headline)}</p><ul>")
        for head, tail in items or [("", "Fixes and improvements.")]:
            parts.append(f"<li><b>{esc(head)}</b>{esc(tail)}</li>")
        parts.append("</ul>")
    parts.append('<p style="font-size:13pt;color:#0e86d4"><b>Version history</b></p>')
    parts.append('<table style="border-collapse:collapse;font-size:10pt">'
                 '<tr style="background:#0f172a;color:#fff"><th style="padding:4px 10px;text-align:left">Version</th>'
                 '<th style="padding:4px 10px;text-align:left">Date</th>'
                 '<th style="padding:4px 10px;text-align:left">Highlights</th></tr>')
    for index, (version, date, headline) in enumerate(history[:10]):
        background = "#dbeafe" if version == new_release["version"] else ("#f1f5f9" if index % 2 == 0 else "#ffffff")
        parts.append(f'<tr style="background:{background}"><td style="padding:4px 10px"><b>{esc(version)}</b></td>'
                     f'<td style="padding:4px 10px">{esc(date)}</td><td style="padding:4px 10px">{esc(headline)}</td></tr>')
    parts.append("</table>")
    parts.append(f"<p>The attached slides (<b>{esc(deck_name)}</b>) cover how to update, all the changes, the version history "
                 f"and the full usage guide. Release notes: <a href=\"{esc(new_release['html_url'])}\">"
                 f"{esc(new_release['html_url'])}</a></p>")
    parts.append(f"<p>Best regards,<br>{esc(config.get('signature', 'Juwen'))}</p>")
    parts.append('<p style="font-size:8pt;color:#94a3b8">(Sent automatically when a new Lingua version is released.)</p>')
    parts.append("</div>")
    return "\n".join(parts)


def outlook():
    import win32com.client
    return win32com.client.Dispatch("Outlook.Application")


def iter_sent_folders(namespace, max_depth=3):
    """Every 'Sent' folder in every store (Exchange mailbox and PST archives such as 20261020)."""
    def walk(folder, depth):
        try:
            name = folder.Name.lower()
        except Exception:
            return
        if "sent" in name or "寄件" in name:
            yield folder
        if depth < max_depth:
            try:
                subfolders = list(folder.Folders)
            except Exception:
                subfolders = []
            for sub in subfolders:
                yield from walk(sub, depth + 1)

    for store in namespace.Stores:
        try:
            root = store.GetRootFolder()
        except Exception:
            continue
        yield from walk(root, 0)


def find_thread_tip(namespace, state, config):
    """Newest message we sent in the Lingua thread (the original or the last update), in any store."""
    since = dt.datetime.fromisoformat(state.get("thread_started", "2026-10-28T00:00"))
    restriction = f"[SentOn] >= '{since.strftime('%m/%d/%Y %H:%M')}'"
    conversation_id = state.get("conversation_id")
    best = None
    for folder in iter_sent_folders(namespace):
        try:
            items = folder.Items.Restrict(restriction)
        except Exception:
            continue
        for item in items:
            try:
                if conversation_id:
                    matches = item.ConversationID == conversation_id
                else:
                    matches = item.Subject == config["thread_subject"]
                if matches and (best is None or item.SentOn > best.SentOn):
                    best = item
            except Exception:
                continue
    if best is not None:
        log.info("thread tip: '%s' sent %s in %s", best.Subject, best.SentOn, best.Parent.FolderPath)
    return best


def insert_after_body(reply_html, new_html):
    match = re.search(r"<body[^>]*>", reply_html, re.I)
    if not match:
        return new_html + reply_html
    return reply_html[:match.end()] + new_html + reply_html[match.end():]


# ------------------------------------------------------------- main
def run(args):
    config = load_json(CONFIG_PATH, None)
    if not config:
        raise SystemExit(f"missing {CONFIG_PATH}")
    state = load_json(STATE_PATH, {})
    lingua_deck.CONTACT.update(config.get("contact", {}))
    last = args.pretend_last or state.get("last_notified_version") or config["baseline_version"]

    releases = fetch_releases(config)
    settle = dt.timedelta(minutes=config.get("settle_minutes", 30))
    now = dt.datetime.now(dt.timezone.utc)
    ready = [r for r in releases if r["download_url"] and now - r["published"] >= settle]
    if not ready:
        say("no complete Lingua releases found")
        return 0
    newest = ready[0]
    say(f"last announced {last}; newest ready release {newest['version']}")
    if version_tuple(newest["version"]) <= version_tuple(last):
        say("nothing new to announce")
        return 0
    if args.status:
        say(f"WOULD announce {newest['version']} (status only)")
        return 0

    changes = build_change_log(ready, last, newest["version"])
    history = [(r["version"], r["date"], headline_of(r)) for r in ready]
    OUT_DIR.mkdir(exist_ok=True)
    deck_name = f"Lingua_{newest['version']}_Update_and_Usage_Guide.pptx"
    deck_path = OUT_DIR / deck_name
    lingua_deck.build_update_deck(newest["version"], last, changes, history, newest["download_url"], deck_path)
    say(f"built {deck_path}")

    app = outlook()
    namespace = app.GetNamespace("MAPI")
    tip = find_thread_tip(namespace, state, config)
    if tip is None:
        say("ERROR: original Lingua thread not found in Sent Items; not sending (will retry next run)")
        return 2
    if not state.get("conversation_id"):
        state["conversation_id"] = tip.ConversationID

    reply = tip.ReplyAll()
    while reply.Recipients.Count:
        reply.Recipients.Remove(1)
    for address in config["recipients"]:
        reply.Recipients.Add(address)
    if not reply.Recipients.ResolveAll():
        say("ERROR: could not resolve all recipients; not sending")
        reply.Close(1)
        return 3
    reply.HTMLBody = insert_after_body(reply.HTMLBody, email_html(newest, last, changes, history, deck_name, config))
    reply.Attachments.Add(str(deck_path))

    if args.dry_run:
        preview = OUT_DIR / f"PREVIEW_{newest['version']}_reply.msg"
        reply.SaveAs(str(preview), 9)  # olMSGUnicode
        say(f"DRY RUN: subject '{reply.Subject}', to {reply.To}; preview saved to {preview}; nothing sent")
        reply.Close(1)  # olDiscard
        return 0

    reply.Send()
    state["last_notified_version"] = newest["version"]
    state.setdefault("history", []).append({
        "version": newest["version"],
        "previous": last,
        "sent_at": dt.datetime.now().isoformat(timespec="seconds"),
        "deck": str(deck_path),
    })
    save_json(STATE_PATH, state)
    say(f"SENT update e-mail for {newest['version']} in thread '{config['thread_subject']}'")
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--pretend-last", help="test only: treat this version as the last announced one")
    args = parser.parse_args()
    if args.pretend_last and not (args.dry_run or args.status):
        raise SystemExit("--pretend-last is only allowed with --dry-run or --status")
    try:
        return run(args)
    except Exception:
        log.exception("notifier run failed")
        raise


if __name__ == "__main__":
    sys.exit(main())
