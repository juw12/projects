import os
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = "file:///" + os.path.join(HERE, "onepager.html").replace("\\", "/")
PDF = os.path.join(os.path.dirname(HERE), "nudge-onepager.pdf")


def launch(p):
    for ch in ("chrome", "msedge"):
        try:
            return p.chromium.launch(channel=ch, headless=True)
        except Exception:
            pass
    return p.chromium.launch(headless=True)


with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={"width": 794, "height": 1123}, device_scale_factor=2)
    pg.goto(HTML, wait_until="load")
    pg.wait_for_timeout(800)
    pg.pdf(path=PDF, format="A4", print_background=True,
           margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
    b.close()
print("PDF:", PDF, os.path.getsize(PDF), "bytes")
