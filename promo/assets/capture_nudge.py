import os
from playwright.sync_api import sync_playwright

OUT = os.path.dirname(os.path.abspath(__file__))
URL = "https://juw12.github.io/nudge/?demo=1"


def launch(p):
    for ch in ("chrome", "msedge"):
        try:
            return p.chromium.launch(channel=ch, headless=True)
        except Exception as e:
            print("launch failed for", ch, ":", e)
    return p.chromium.launch(headless=True)


def main():
    frames = []
    with sync_playwright() as p:
        b = launch(p)
        try:
            pg = b.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=2)
            pg.goto(URL, wait_until="load", timeout=60000)
            pg.wait_for_timeout(3500)
            pg.screenshot(path=os.path.join(OUT, "nudge-desktop.png"))
            pg.screenshot(path=os.path.join(OUT, "nudge-desktop-full.png"), full_page=True)
            h = pg.evaluate("() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)")
            print("page height:", h)

            steps = 6
            for i in range(steps):
                y = int((h - 960) * i / max(1, steps - 1)) if h > 960 else 0
                pg.evaluate(f"window.scrollTo(0,{y})")
                pg.wait_for_timeout(700)
                fp = os.path.join(OUT, f"_f{i}.png")
                pg.screenshot(path=fp)
                frames.append(fp)

            mp = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=3)
            mp.goto(URL, wait_until="load", timeout=60000)
            mp.wait_for_timeout(3500)
            mp.screenshot(path=os.path.join(OUT, "nudge-mobile.png"))
        finally:
            b.close()

    try:
        from PIL import Image
        imgs = [Image.open(f).convert("RGB") for f in frames]
        w = 900
        imgs = [im.resize((w, int(im.height * w / im.width))) for im in imgs]
        hh = min(im.height for im in imgs)
        imgs = [im.crop((0, 0, w, hh)) for im in imgs]
        imgs[0].save(os.path.join(OUT, "nudge-scroll.gif"), save_all=True,
                     append_images=imgs[1:], duration=900, loop=0, optimize=True)
    except Exception as e:
        print("gif failed:", e)

    for f in frames:
        try:
            os.remove(f)
        except Exception:
            pass
    print("DONE")


main()
