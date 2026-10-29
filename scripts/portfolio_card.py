#!/usr/bin/env python3
"""Make a portfolio project card in the house style, or audit the existing cards.

House style (every software card since 2026-10-28): a 1600x1000 JPEG of the app's
real UI inside a browser window - traffic lights plus an "app · view" address pill -
on a dark backdrop tinted with the app's accent colour, with a faint 28 px dot grid.
The frame geometry is fixed so every card lines up on the portfolio: window
x 130-1470, top 96, 22 px corners, 45 px title bar, bleeding off the bottom edge.

Never hand-draw, halftone or drop a raw screenshot in as card art. Run this instead:

    python scripts/portfolio_card.py vitals                      # capture the live app
    python scripts/portfolio_card.py pips --screenshot ui.png    # frame a screenshot you took
    python scripts/portfolio_card.py --check                     # audit every listed card

Per-app settings live in an optional "card" object of the app in scripts/apps.json:

    "card": {
      "capture": "vitals/index.html#demo",  page to capture, relative to the Pages site (default: links.web)
      "frame_image": "pips-pet-hero.jpg",   or frame this image from assets/projects instead of capturing
                                            (for native apps and designed hero art)
      "label": "vitals · home",             address-pill text (default: the app id)
      "click": ["text=Detailed view"],      Playwright selectors to click before capturing
      "wait_ms": 1500,                      extra settle time after load (default 1200)
      "accent": "#2ee6b0",                  backdrop glow colour (default: sampled from the UI)
      "accent2": "#3d7bf5",                 bottom-right glow (default: accent hue + 45 degrees)
      "theme": "dark"                       capture the app in this colour scheme and use matching
                                            window chrome (default: the app's own default, chrome
                                            picked from the captured UI)
    }

The card is written to <portfolio>/assets/projects/<image> (the app's "image" field),
so publish_portfolio.py picks it up unchanged. Generating needs Playwright (a dev-only
dependency: pip install playwright); installed Microsoft Edge or Google Chrome is used
when present, otherwise run "python -m playwright install chromium" once. --check uses
only the standard library, plus Pillow for the colour test when it is installed.
"""

import argparse
import base64
import json
import struct
import sys
from pathlib import Path
from string import Template
from urllib.parse import urljoin

from publish_portfolio import SITE_BASE, load_apps, repo_root

CARD_WIDTH, CARD_HEIGHT = 1600, 1000
WINDOW_X, WINDOW_Y, WINDOW_WIDTH = 130, 96, 1340
TITLE_BAR_HEIGHT = 45
CAPTURE_HEIGHT = 1000  # CSS px; the card shows the top ~860 px
CAPTURE_SCALE = 2      # capture at 2x, the browser downsamples for crisp text
JPEG_QUALITY = 86
DEFAULT_WAIT_MS = 1200

# Acceptance rules for --check and publish_portfolio.py. 16:9 heroes still crop
# cleanly into the 16:10 card slot, so they pass the size rule.
MIN_CARD_WIDTH = 1600
ASPECT_RANGE = (1.55, 1.80)
MIN_MEAN_SATURATION = 0.10  # house cards measure 0.16-0.63; the old halftone art 0.02

CARD_TEMPLATE = Template("""<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${card_width}px; height: ${card_height}px; overflow: hidden; }
  body {
    position: relative;
    background: var(--base, #1d1a49);
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Inter, "Helvetica Neue", Arial, sans-serif;
  }
  .glow {
    position: absolute; inset: 0;
    background:
      radial-gradient(circle at 200px 40px, var(--glow1) 0, transparent 600px),
      radial-gradient(circle at ${card_width}px ${card_height}px, var(--glow2) 0, transparent 560px);
  }
  .dots {
    position: absolute; inset: 0;
    background-image: radial-gradient(circle at 14px 14px, rgba(255, 255, 255, 0.075) 0 1.2px, transparent 1.7px);
    background-size: 28px 28px;
  }
  .window {
    position: absolute; left: ${window_x}px; top: ${window_y}px;
    width: ${window_width}px; height: ${window_height}px;
    border-radius: 22px 22px 0 0; overflow: hidden; background: var(--chrome);
    box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--edge);
  }
  .bar { position: relative; height: ${bar_height}px; background: var(--chrome); box-shadow: inset 0 -1px 0 var(--edge); }
  .content { background: var(--content-bg, transparent); height: 100%; }
  .light { position: absolute; top: 16.5px; width: 13px; height: 13px; border-radius: 50%; }
  .red { left: 19.5px; background: #ff5f57; }
  .amber { left: 42.5px; background: #febc2e; }
  .green { left: 65.5px; background: #28c840; }
  .pill {
    position: absolute; left: 107px; top: 9.5px; width: 420px; height: 26px; border-radius: 8px;
    background: var(--pill); color: var(--pill-text);
    font-size: 13.5px; line-height: 26px; text-align: center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .shot { display: block; width: ${window_width}px; height: auto; }
</style></head>
<body>
  <div class="glow"></div>
  <div class="dots"></div>
  <div class="window">
    <div class="bar">
      <span class="light red"></span><span class="light amber"></span><span class="light green"></span>
      <div class="pill" id="label"></div>
    </div>
    <div class="content"><img class="shot" id="shot" alt="" src="data:${mime};base64,${shot}"></div>
  </div>
<script>
const settings = ${settings};

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map(value => Math.round((value + m) * 255));
}

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = rgb => "#" + rgb.map(value => value.toString(16).padStart(2, "0")).join("");
const rgba = (rgb, alpha) => `rgba($${rgb[0]}, $${rgb[1]}, $${rgb[2]}, $${alpha})`;
const mix = (a, b, t) => a.map((value, i) => Math.round(value + (b[i] - value) * t));
const lum = rgb => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;

function averageRows(data, width, fromRow, toRow) {
  const sum = [0, 0, 0];
  let count = 0;
  for (let i = fromRow * width * 4; i < toRow * width * 4; i += 4) {
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
    count += 1;
  }
  return sum.map(value => Math.round(value / count));
}

function analyse(image) {
  const width = 268;
  const height = Math.round(image.naturalHeight * width / image.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;

  const strip = Math.max(2, Math.round(height * 0.05));
  const top = averageRows(data, width, 0, strip);
  const bottom = averageRows(data, width, height - Math.max(2, Math.round(height * 0.03)), height);

  const buckets = Array.from({ length: 36 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (s < 0.45 || v < 0.35) continue;
    const bucket = buckets[Math.floor(h / 10) % 36];
    const weight = s * v;
    bucket.weight += weight;
    bucket.r += data[i] * weight;
    bucket.g += data[i + 1] * weight;
    bucket.b += data[i + 2] * weight;
  }
  const best = buckets.reduce((a, b) => (b.weight > a.weight ? b : a));
  const accent = best.weight > 0
    ? [best.r, best.g, best.b].map(value => Math.round(value / best.weight))
    : [99, 102, 241];
  return { light: lum(top) > 0.55, top, bottom, accent };
}

async function build() {
  const image = document.getElementById("shot");
  await image.decode();
  document.getElementById("label").textContent = settings.label;
  const measured = analyse(image);
  const theme = settings.theme || (measured.light ? "light" : "dark");
  const accent = settings.accent ? hexToRgb(settings.accent) : measured.accent;
  const [hue, saturation] = rgbToHsv(...accent);
  const sat = Math.min(Math.max(saturation, 0.5), 0.9);
  const base = hsvToRgb(hue, Math.min(sat, 0.85), 0.2);
  const glow1 = hsvToRgb(hue, sat * 0.85, 0.78);
  const glow2 = settings.accent2 ? hexToRgb(settings.accent2) : hsvToRgb(hue + 45, 0.7, 0.62);
  // The title bar takes the app's own top colour when it fits the theme (like the
  // hand-made originals: white for Orbis, cream for Peers, near-black for Glow).
  const light = theme === "light";
  const bar = light
    ? (lum(measured.top) > 0.85 ? measured.top : [255, 255, 255])
    : (lum(measured.top) < 0.22 ? measured.top : [28, 28, 30]);
  const chrome = {
    chrome: rgba(bar, 1),
    pill: rgba(light ? mix(bar, [20, 30, 90], 0.045) : mix(bar, [255, 255, 255], 0.07), 1),
    text: light ? "#62626a" : "#a7b0bd",
    edge: light ? "rgba(0, 0, 0, 0.07)" : "rgba(255, 255, 255, 0.07)",
  };
  const root = document.documentElement.style;
  root.setProperty("--base", rgba(base, 1));
  root.setProperty("--glow1", rgba(glow1, 0.9));
  root.setProperty("--glow2", rgba(glow2, 0.8));
  root.setProperty("--chrome", chrome.chrome);
  root.setProperty("--pill", chrome.pill);
  root.setProperty("--pill-text", chrome.text);
  root.setProperty("--edge", chrome.edge);
  root.setProperty("--content-bg", rgba(measured.bottom, 1));
  window.cardInfo = { theme, accent: toHex(accent), accent2: toHex(glow2) };
}

build()
  .catch(error => { window.cardError = String(error); })
  .finally(() => { window.cardReady = true; });
</script>
</body></html>
""")


def default_portfolio_dir():
    return repo_root().parent / "portfolio"


def card_path(portfolio_dir, app):
    return Path(portfolio_dir) / "assets" / "projects" / app["image"]


def image_size(path):
    """(width, height) of a JPEG or PNG, using only the standard library."""
    with open(path, "rb") as handle:
        head = handle.read(24)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", head[16:24])
        if head[:2] != b"\xff\xd8":
            raise ValueError("not a JPEG or PNG file")
        handle.seek(2)
        while True:
            byte = handle.read(1)
            while byte and byte != b"\xff":
                byte = handle.read(1)
            marker = handle.read(1)
            while marker == b"\xff":
                marker = handle.read(1)
            if not marker:
                raise ValueError("no JPEG frame header found")
            code = marker[0]
            if code == 0x01 or 0xD0 <= code <= 0xD9:
                continue  # markers without a length field
            (length,) = struct.unpack(">H", handle.read(2))
            if 0xC0 <= code <= 0xCF and code not in (0xC4, 0xC8, 0xCC):
                height, width = struct.unpack(">xHH", handle.read(5))
                return width, height
            handle.seek(length - 2, 1)


def mean_saturation(path):
    """Average HSV saturation (0-1), or None when Pillow is not installed."""
    try:
        from PIL import Image, ImageStat
    except ImportError:
        return None
    with Image.open(path) as picture:
        small = picture.convert("RGB").resize((160, 100))
        return ImageStat.Stat(small.convert("HSV")).mean[1] / 255


def card_problems(portfolio_dir, apps):
    """House-style problems for every card shown on the portfolio (empty list = all good)."""
    problems = []
    for app in apps:
        if not (app.get("listed", True) and app.get("portfolio", True)):
            continue
        path = card_path(portfolio_dir, app)
        if not path.is_file():
            problems.append(f"{app['id']}: card image {path.name} is missing")
            continue
        try:
            width, height = image_size(path)
        except (OSError, ValueError, struct.error) as error:
            problems.append(f"{app['id']}: card image {path.name} is unreadable ({error})")
            continue
        aspect = width / height
        if width < MIN_CARD_WIDTH or not ASPECT_RANGE[0] <= aspect <= ASPECT_RANGE[1]:
            problems.append(
                f"{app['id']}: {path.name} is {width}x{height}; house-style cards are "
                f"{CARD_WIDTH}x{CARD_HEIGHT}"
            )
            continue
        saturation = mean_saturation(path)
        if saturation is not None and saturation < MIN_MEAN_SATURATION:
            problems.append(
                f"{app['id']}: {path.name} looks greyscale or washed out (mean saturation "
                f"{saturation:.2f}); house-style cards are full colour on a dark backdrop"
            )
    return problems


def fix_hint(problems):
    ids = sorted({problem.split(":", 1)[0] for problem in problems})
    commands = "\n".join(f"  python scripts/portfolio_card.py {app_id}" for app_id in ids)
    return (
        "Make house-style card art (framed live UI on the dark gradient) with:\n"
        f"{commands}\n"
        "Per-app capture settings go in the app's \"card\" object in scripts/apps.json."
    )


def launch_browser(playwright):
    for channel in ("msedge", "chrome", None):
        try:
            if channel:
                return playwright.chromium.launch(channel=channel)
            return playwright.chromium.launch()
        except Exception:  # browser channel not installed; try the next one
            continue
    raise SystemExit(
        "ERROR: no Chromium-based browser found. Install Edge or Chrome, "
        "or run: python -m playwright install chromium"
    )


def capture(browser, url, clicks, wait_ms, theme=None):
    from playwright.sync_api import TimeoutError as PlaywrightTimeout

    context = browser.new_context(
        viewport={"width": WINDOW_WIDTH, "height": CAPTURE_HEIGHT},
        device_scale_factor=CAPTURE_SCALE,
        color_scheme=theme or "no-preference",
        reduced_motion="reduce",
    )
    page = context.new_page()
    page.goto(url, wait_until="load", timeout=90_000)
    try:
        page.wait_for_load_state("networkidle", timeout=8_000)
    except PlaywrightTimeout:
        pass  # apps that poll never go fully idle; the load event is enough
    for selector in clicks:
        page.click(selector, timeout=15_000)
        page.wait_for_timeout(500)
    page.wait_for_timeout(wait_ms)
    # Freeze CSS animations so looping pets, spinners and marquees cannot stall the capture.
    png = page.screenshot(type="png", animations="disabled", timeout=90_000)
    context.close()
    return png


def compose(browser, shot_bytes, mime, settings, out_path):
    context = browser.new_context(
        viewport={"width": CARD_WIDTH, "height": CARD_HEIGHT},
        device_scale_factor=1,
    )
    page = context.new_page()
    html = CARD_TEMPLATE.substitute(
        card_width=CARD_WIDTH,
        card_height=CARD_HEIGHT,
        window_x=WINDOW_X,
        window_y=WINDOW_Y,
        window_width=WINDOW_WIDTH,
        window_height=CARD_HEIGHT - WINDOW_Y + 40,
        bar_height=TITLE_BAR_HEIGHT,
        mime=mime,
        shot=base64.b64encode(shot_bytes).decode("ascii"),
        settings=json.dumps(settings),
    )
    page.set_content(html, wait_until="load")
    page.wait_for_function("window.cardReady === true", timeout=20_000)
    error = page.evaluate("window.cardError || null")
    if error:
        raise SystemExit(f"ERROR: could not build the card: {error}")
    info = page.evaluate("window.cardInfo")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out_path), type="jpeg", quality=JPEG_QUALITY)
    context.close()
    return info


def make_card(app, args):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("ERROR: generating cards needs Playwright: pip install playwright")

    card = dict(app.get("card") or {})
    for key in ("label", "accent", "accent2", "theme"):
        if getattr(args, key):
            card[key] = getattr(args, key)
    if args.click:
        card["click"] = args.click
    settings = {
        "label": card.get("label", app["id"]),
        "accent": card.get("accent"),
        "accent2": card.get("accent2"),
        "theme": card.get("theme"),
    }
    out_path = Path(args.out) if args.out else card_path(args.portfolio_dir, app)

    with sync_playwright() as playwright:
        browser = launch_browser(playwright)
        frame_image = args.screenshot or (
            str(Path(args.portfolio_dir) / "assets" / "projects" / card["frame_image"])
            if card.get("frame_image") and not args.url else None
        )
        if frame_image:
            shot_path = Path(frame_image)
            shot_bytes = shot_path.read_bytes()
            mime = "image/jpeg" if shot_path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
            source = str(shot_path)
        else:
            relative = args.url or card.get("capture") or app["links"]["web"]
            source = urljoin(SITE_BASE, relative)
            print(f"Capturing {source}")
            shot_bytes = capture(
                browser,
                source,
                card.get("click", []),
                int(card.get("wait_ms", DEFAULT_WAIT_MS)),
                settings["theme"],
            )
            mime = "image/png"
        info = compose(browser, shot_bytes, mime, settings, out_path)
        browser.close()

    print(f"Wrote {out_path} ({CARD_WIDTH}x{CARD_HEIGHT}) from {source}")
    print(
        f"Palette: theme={info['theme']} accent={info['accent']} accent2={info['accent2']} "
        "(pin these in the app's \"card\" object to keep the colours stable)"
    )
    problems = card_problems(args.portfolio_dir, [app]) if not args.out else []
    for problem in problems:
        print(f"WARNING: {problem}")


def main():
    parser = argparse.ArgumentParser(description="Make or audit house-style portfolio cards")
    parser.add_argument("app_id", nargs="?", help="App id from scripts/apps.json")
    parser.add_argument("--check", action="store_true", help="Audit every listed card and exit")
    parser.add_argument(
        "--portfolio-dir", default=str(default_portfolio_dir()),
        help="Portfolio repo directory (default: ../portfolio next to the monorepo)",
    )
    parser.add_argument("--screenshot", help="Frame this PNG/JPEG instead of capturing the live app")
    parser.add_argument("--url", help="Capture this page instead (absolute or relative to the Pages site)")
    parser.add_argument("--click", action="append", help="Selector to click before capturing (repeatable)")
    parser.add_argument("--label", help="Address-pill text, e.g. 'vitals · home'")
    parser.add_argument("--accent", help="Backdrop glow colour, e.g. '#2ee6b0'")
    parser.add_argument("--accent2", help="Bottom-right glow colour")
    parser.add_argument("--theme", choices=("dark", "light"), help="Window chrome")
    parser.add_argument("--out", help="Write here instead of <portfolio>/assets/projects/<image>")
    args = parser.parse_args()
    args.portfolio_dir = Path(args.portfolio_dir).expanduser().resolve()

    apps = load_apps()
    if args.check:
        problems = card_problems(args.portfolio_dir, apps)
        shown = sum(1 for a in apps if a.get("listed", True) and a.get("portfolio", True))
        if _pillow_missing():
            print("Note: Pillow not installed, colour test skipped (pip install pillow)")
        for problem in problems:
            print(f"PROBLEM: {problem}")
        if problems:
            print(fix_hint(problems))
            sys.exit(1)
        print(f"All {shown} portfolio cards follow the house style.")
        return

    if not args.app_id:
        parser.error("give an app id, or --check")
    app = next((a for a in apps if a["id"] == args.app_id), None)
    if app is None:
        parser.error(f"unknown app id {args.app_id!r}")
    make_card(app, args)


def _pillow_missing():
    try:
        import PIL  # noqa: F401
    except ImportError:
        return True
    return False


if __name__ == "__main__":
    main()
