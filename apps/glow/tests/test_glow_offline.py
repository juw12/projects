"""Glow 1.22: offline Glow (every app opens with no internet, Glow Offline on-device AI in GlowChat),
the free iPhone/iPad Home Screen app, and the download/search pages.

Static checks always run. Browser checks need Playwright. The on-device AI check also needs a GPU with
WebGPU and a local copy of a model, so it only runs when GLOW_OFFLINE_MODEL_DIR points at a folder laid out
like <dir>/<model_id>/resolve/main/<files> (it is skipped in CI).
Run from the repo root:  python -X utf8 apps/glow/tests/test_glow_offline.py
"""
import functools
import http.server
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
REPO = APP.parent.parent
LIVE = "https://juw12.github.io/projects/glow/"
CHAT_PAGES = ["index.html", "app.html", "mobile.html"]

try:
    from playwright.sync_api import sync_playwright
    HAVE_PLAYWRIGHT = True
except ImportError:
    HAVE_PLAYWRIGHT = False


def read(path):
    return (WEB / path).read_text(encoding="utf-8")


def png_size(path):
    data = path.read_bytes()[:32]
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"{path} is not a PNG")
    return struct.unpack(">II", data[16:24])


def json_ld_blocks(html):
    return [json.loads(block) for block in re.findall(r'<script type="application/ld\+json">\s*([\s\S]*?)\s*</script>', html)]


class OfflineAiStatic(unittest.TestCase):
    def test_vendored_webllm(self):
        source = read("shared/vendor/web-llm.js")
        self.assertIn("@mlc-ai/web-llm 0.2.86", source.splitlines()[0])
        self.assertTrue((WEB / "shared/vendor/web-llm.LICENSE.txt").exists())
        self.assertIn("MLCEngine", source)
        for family in ["Qwen2.5-0.5B-Instruct", "Qwen2.5-1.5B-Instruct", "Qwen2.5-3B-Instruct"]:
            for quant in ["q4f16_1", "q4f32_1"]:
                self.assertIn(f'model_id: "{family}-{quant}-MLC"', source, f"{family} {quant} missing from WebLLM's model list")

    def test_engine_worker_and_facade(self):
        engine = read("shared/glow-offline-engine.js")
        worker = read("shared/glow-offline-worker.js")
        facade = read("shared/glow-offline-ai.js")
        self.assertIn('from "./vendor/web-llm.js"', engine)
        self.assertIn('from "./glow-offline-engine.js"', worker)
        for op in ["probe", "status", "load", "chat", "abort", "unload", "delete"]:
            self.assertIn(f'case "{op}"', engine)
        self.assertIn("modelscope.cn", facade, "ModelScope must stay as the mirror for networks that block Hugging Face")
        self.assertIn("contextWindow: isPhone ? 2048 : 4096", facade, "phones need the smaller context window")
        self.assertIn("window.GlowOfflineAI", facade)

    def test_glowchat_wiring(self):
        for page in CHAT_PAGES:
            html = read(f"chat/{page}")
            self.assertIn("'wasm-unsafe-eval'", html, page)
            self.assertIn('id="offline-ai-panel"', html, page)
            self.assertLess(html.index("glow-offline-ai.js"), html.index('src="./app.js"'), page)
        app = read("chat/app.js")
        self.assertIn('if (provider === "local") return await streamLocal(', app)
        self.assertIn("NETWORK_PROVIDERS.has(provider)", app)
        self.assertIn("offlineFallbackModel()", app)
        locale = read("shared/glow-locale.js")
        self.assertIn('["ollama", "custom", "demo", "local"]', locale, "on-device models must never be region-filtered")

    def test_offline_caches(self):
        chat_sw = read("chat/sw.js")
        self.assertIn("'../shared/glow-offline-ai.js'", chat_sw)
        self.assertIn("'./',", chat_sw)
        update_cleanup = re.search(r"name\) => (/\^\(glow\|crewroom\)/)\.test\(name\)", read("shared/glow-apps.js"))
        self.assertIsNotNone(update_cleanup, "the Update now cache cleanup changed; check it still spares WebLLM's caches")
        self.assertFalse(re.match(r"^(glow|crewroom)", "webllm/model"))
        for sw in ["sw.js", "chat/sw.js", "lead/sw.js", "room/sw.js"]:
            self.assertIn("NETWORK_TIMEOUT_MS", read(sw), f"{sw} should fall back to the saved copy on slow networks")
        home_assets = re.findall(r"'(\./[^']+)'", read("sw.js"))
        missing = [a for a in home_assets if not (WEB / a.rstrip("/")).exists()]
        self.assertEqual(missing, [], "home service worker caches files that don't exist")

    def test_every_app_is_prepared_for_offline(self):
        apps = read("shared/glow-apps.js")
        for script in ['["sw.js", ""]', '["chat/sw.js", "chat/"]', '["room/sw.js", "room/"]', '["lead/sw.js", "lead/"]']:
            self.assertIn(script, apps)
        self.assertIn("if (isStandalone() && navigator.storage && navigator.storage.persist)", apps)


class IphoneAndSearchStatic(unittest.TestCase):
    def test_home_screen_tags(self):
        for page in ["index.html", "download/index.html", "chat/index.html", "chat/mobile.html"]:
            html = read(page)
            self.assertIn('name="apple-mobile-web-app-capable" content="yes"', html, page)
            self.assertIn('name="apple-mobile-web-app-title" content="Glow"', html, page)
            prefix = "../" if "/" in page else "./"
            self.assertIn(f'rel="apple-touch-icon" href="{prefix}icons/apple-touch-icon.png"', html, page)
            images = re.findall(r'<link rel="apple-touch-startup-image" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\)[^"]*" href="[^"]*icons/splash/([^"]+)">', html)
            self.assertGreaterEqual(len(images), 12, page)
            for width, height, ratio, name in images:
                self.assertEqual(png_size(WEB / "icons" / "splash" / name), (int(width) * int(ratio), int(height) * int(ratio)), name)

    def test_touch_icon_is_opaque_180(self):
        icon = WEB / "icons" / "apple-touch-icon.png"
        self.assertEqual(png_size(icon), (180, 180))
        color_type = icon.read_bytes()[25]
        self.assertIn(color_type, (2, 3), "iOS draws transparent touch icons on black: keep it opaque")

    def test_install_guide(self):
        apps = read("shared/glow-apps.js")
        self.assertIn("function showInstallGuide", apps)
        self.assertIn("Choose Add to Home Screen.", apps)
        self.assertIn("showInstallGuide, isStandalone, isAppleMobile", apps)
        self.assertIn("showInstallGuide({ force: true })", read("home.js"))

    def test_home_seo(self):
        html = read("index.html")
        self.assertIn(f'<link rel="canonical" href="{LIVE}">', html)
        self.assertIn("<title>Glow AI", html)
        self.assertIn(f'content="{LIVE}icons/og-image.png"', html)
        self.assertEqual(png_size(WEB / "icons" / "og-image.png"), (1200, 630))
        app = next(block for block in json_ld_blocks(html) if block["@type"] == "SoftwareApplication")
        self.assertEqual(app["offers"]["price"], "0")
        self.assertEqual(app["downloadUrl"], LIVE + "download/")
        self.assertIn('href="./download/"', html)

    def test_download_page(self):
        html = read("download/index.html")
        self.assertIn(f'<link rel="canonical" href="{LIVE}download/">', html)
        self.assertIn("releases/download/glow-windows/Glow-Setup.exe", html)
        self.assertIn("releases/download/glow-android/Glow-android.apk", html)
        types = [block["@type"] for block in json_ld_blocks(html)]
        self.assertEqual(sorted(types), ["FAQPage", "SoftwareApplication"])
        self.assertNotRegex(html, r"<script(?![^>]*\b(src=|type=\"application/ld\+json\"))[^>]*>\s*\S", "no inline scripts (CSP)")
        for ref in re.findall(r'(?:src|href)="(\.[^"#?]+)"', html):
            self.assertTrue(((WEB / "download") / ref).resolve().exists(), ref)

    def test_manifest_is_store_ready(self):
        manifest = json.loads(read("manifest.webmanifest"))
        self.assertEqual(manifest["id"], "./")
        purposes = {icon.get("purpose", "any") for icon in manifest["icons"]}
        self.assertIn("maskable", purposes)
        for icon in manifest["icons"]:
            self.assertTrue((WEB / icon["src"]).exists(), icon["src"])
        forms = {shot["form_factor"]: shot for shot in manifest["screenshots"]}
        self.assertEqual(set(forms), {"wide", "narrow"})
        for shot in manifest["screenshots"]:
            width, height = (int(n) for n in shot["sizes"].split("x"))
            self.assertEqual(png_size(WEB / shot["src"]), (width, height), shot["src"])

    def test_sitemap_and_indexnow(self):
        urls = re.findall(r"<loc>([^<]+)</loc>", read("sitemap.xml"))
        self.assertIn(LIVE, urls)
        self.assertIn(LIVE + "download/", urls)
        for url in urls:
            path = url[len(LIVE):]
            target = WEB / (path + "index.html" if path.endswith("/") or not path else path)
            self.assertTrue(target.exists(), url)
        keys = [p for p in WEB.glob("*.txt") if re.fullmatch(r"[0-9a-f]{32}", p.stem)]
        self.assertEqual(len(keys), 1)
        self.assertEqual(keys[0].read_text(encoding="utf-8").strip(), keys[0].stem)
        result = subprocess.run([sys.executable, str(APP / "tools" / "indexnow.py"), "--dry-run"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_versions_match(self):
        published = json.loads(read("version.json"))["version"]
        self.assertIn(f'const GLOW_VERSION = "{published}";', read("shared/glow-apps.js"))
        self.assertEqual(json.loads((APP / "mobile" / "package.json").read_text(encoding="utf-8"))["version"], published)


class GlowPagesServer:
    """Serves apps/glow/web under /projects/glow/ like GitHub Pages, plus optional local model files."""

    def __init__(self, model_dir=None):
        web_root = str(WEB)
        models = str(model_dir) if model_dir else None

        class Handler(http.server.SimpleHTTPRequestHandler):
            def translate_path(self, path):
                clean = path.split("?", 1)[0].split("#", 1)[0]
                if models and clean.startswith("/models/"):
                    return os.path.join(models, *clean[len("/models/"):].split("/"))
                if clean.startswith("/projects/glow/"):
                    return os.path.join(web_root, *clean[len("/projects/glow/"):].split("/"))
                return os.path.join(web_root, "__missing__")

            def end_headers(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                super().end_headers()

            def log_message(self, *_args):
                pass

        class QuietServer(http.server.ThreadingHTTPServer):
            def handle_error(self, request, client_address):
                # The browser cancels some downloads on purpose (Glow's reachability probe); that's not an error.
                if not isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
                    super().handle_error(request, client_address)

        self.server = QuietServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.base = self.origin + "/projects/glow/"

    def close(self):
        self.server.shutdown()


def launch_browser(playwright, **kwargs):
    try:
        return playwright.chromium.launch(**kwargs)
    except Exception:
        return playwright.chromium.launch(channel="chrome", **kwargs)


WAIT_FOR_WORKERS = """
async () => {
  for (let i = 0; i < 80; i++) {
    const regs = await navigator.serviceWorker.getRegistrations();
    const ready = regs.filter((r) => r.active && r.active.state === 'activated').map((r) => new URL(r.scope).pathname);
    if (ready.length >= 4) return ready.sort();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname + ':' + (r.active ? r.active.state : 'none'));
}
"""

# GlowChat sets up its first conversation after boot; sendChat() reads the model from the picker.
WAIT_FOR_CHAT = "() => typeof current !== 'undefined' && current !== null && document.getElementById('chat-model').options.length > 0"
# First visit: continue as a guest (works with no internet) and skip the persona quiz and guided tour.
CONTINUE_AS_GUEST = """
() => {
  Object.assign(state.settings, { personaOnboarded: true, tourDone: true });
  saveState();
  const welcome = document.getElementById('welcome-screen');
  if (!welcome.classList.contains('hidden')) document.getElementById('guest-btn').click();
  if (document.getElementById('persona-modal').classList.contains('open')) closePersonaStudio(false);
  if (typeof endTour === 'function') endTour(false);
  return welcome.classList.contains('hidden');
}
"""
PICK_FREE_MODEL = """
() => {
  const picker = document.getElementById('chat-model');
  picker.value = 'free::openai-fast';
  picker.dispatchEvent(new Event('change'));
  return picker.value;
}
"""

INSIDE_VIEWPORT = """
(selector) => {
  const box = document.querySelector(selector).getBoundingClientRect();
  return box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5
    && Math.abs((box.left + box.right) / 2 - innerWidth / 2) < 2;
}
"""


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run browser checks")
class OfflineInBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pages = GlowPagesServer()
        cls.playwright = sync_playwright().start()
        cls.browser = launch_browser(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.pages.close()

    def test_every_app_opens_with_no_internet(self):
        context = self.browser.new_context()
        page = context.new_page()
        page.goto(self.pages.base)
        scopes = page.evaluate(WAIT_FOR_WORKERS)
        self.assertEqual(scopes, ["/projects/glow/", "/projects/glow/chat/", "/projects/glow/lead/", "/projects/glow/room/"])
        context.set_offline(True)
        checks = {
            "": "#start-input",
            "chat/": "#messages",
            "chat/mobile.html": "#messages",
            "room/": "body",
            "lead/": "body",
            "download/": "#for-you",
            "setup/": "#windows",
            "account/": "#account",
        }
        for path, selector in checks.items():
            page.goto(self.pages.base + path)
            page.wait_for_selector(selector, timeout=15000)
            self.assertNotIn("ERR_INTERNET_DISCONNECTED", page.content(), path)
        page.goto(self.pages.base + "chat/")
        page.wait_for_function("document.getElementById('status').textContent.startsWith(\"You're offline\")", timeout=15000)
        context.close()

    def test_offline_without_a_model_explains_what_to_do(self):
        context = self.browser.new_context()
        page = context.new_page()
        page.goto(self.pages.base + "chat/")
        page.wait_for_function(WAIT_FOR_CHAT, timeout=20000)
        self.assertTrue(page.evaluate(CONTINUE_AS_GUEST))
        self.assertEqual(page.evaluate(PICK_FREE_MODEL), "free::openai-fast")
        context.set_offline(True)
        page.fill("#input", "Hello")
        page.click("#send-btn")
        page.wait_for_function("document.body.innerText.includes('download Glow Offline')", timeout=15000)
        self.assertEqual(page.evaluate("current.messages.filter((m) => m.role === 'user').length"), 1, "the question stays in the chat")
        context.close()

    def test_settings_panel_without_webgpu(self):
        context = self.browser.new_context()
        context.add_init_script("Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });")
        page = context.new_page()
        page.goto(self.pages.base + "chat/")
        page.wait_for_selector("#settings-btn")
        page.evaluate("() => openSettings()")
        page.wait_for_function("document.getElementById('offline-ai-panel').innerText.includes('WebGPU')", timeout=10000)
        context.close()

    def test_iphone_install_guide(self):
        device = dict(self.playwright.devices["iPhone 15"])
        device.pop("default_browser_type", None)
        context = self.browser.new_context(**device)
        page = context.new_page()
        page.goto(self.pages.base)
        page.wait_for_selector(".glow-install-sheet:not([hidden])", timeout=12000)
        page.wait_for_timeout(400)  # let the slide-in animation finish
        self.assertTrue(page.evaluate(INSIDE_VIEWPORT, ".glow-install-sheet"), "the install sheet must sit fully on screen, centred")
        sheet = page.inner_text(".glow-install-sheet")
        self.assertIn("Add to Home Screen", sheet)
        self.assertIn("iPhone", sheet)
        page.evaluate("""() => {
          const bar = document.createElement('div');
          bar.className = 'glow-update-bar';
          bar.innerHTML = '<span>✦ <b>Glow 9.9.9 is ready</b><small>Glow Offline: chat with AI on this device with no internet</small></span>'
            + '<button class="go" type="button">Update now</button><button class="later" type="button">Later</button>';
          document.body.appendChild(bar);
        }""")
        page.wait_for_timeout(400)
        self.assertTrue(page.evaluate(INSIDE_VIEWPORT, ".glow-update-bar"), "the Update now bar must sit fully on screen, centred")
        page.click("[data-install-ok]")
        self.assertTrue(page.evaluate("Boolean(localStorage.getItem('glow.ios.install.dismissed'))"))
        page.goto(self.pages.base + "download/")
        page.wait_for_function("document.getElementById('for-you-title').textContent.includes('iPhone')")
        self.assertFalse(page.is_visible("#on-phone"))
        context.close()

    def test_download_page_recommends_windows_setup(self):
        context = self.browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")
        page = context.new_page()
        page.goto(self.pages.base + "download/")
        page.wait_for_selector("#for-you-actions a[href$='Glow-Setup.exe']")
        self.assertTrue(page.is_visible("#page-qr svg"))
        context.close()


MODEL_DIR = os.environ.get("GLOW_OFFLINE_MODEL_DIR")


@unittest.skipUnless(HAVE_PLAYWRIGHT and MODEL_DIR, "Set GLOW_OFFLINE_MODEL_DIR (and use a GPU with WebGPU) to run the on-device AI check")
class GlowOfflineEndToEnd(unittest.TestCase):
    """Download Glow Offline Mini in GlowChat Settings, cut the network, reload and get a real answer.

    GLOW_OFFLINE_MODEL_DIR/<model_id>/resolve/main/ needs the MLC files WebLLM 0.2.86 reads: mlc-chat-config.json,
    tensor-cache.json, params_shard_*.bin and the tokenizer files (the model library still comes from GitHub).
    """

    def test_download_then_answer_offline(self):
        pages = GlowPagesServer(MODEL_DIR)
        profile = Path(os.environ.get("GLOW_OFFLINE_PROFILE") or tempfile.mkdtemp(prefix="glow-offline-profile-"))
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                str(profile), channel="chrome", headless=True,
                args=["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"],
            )
            context.add_init_script(
                "window.GLOW_OFFLINE_SOURCES = { local: (id) => location.origin + '/models/' + id + '/resolve/main/' };"
                "window.GLOW_OFFLINE_SOURCE_ORDER = ['local'];"
            )
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(pages.base + "chat/")
            page.wait_for_function(WAIT_FOR_CHAT, timeout=30000)
            self.assertTrue(page.evaluate(CONTINUE_AS_GUEST))
            page.evaluate("() => openSettings()")
            page.wait_for_selector("[data-offline-get='mini'], [data-offline-use='mini']", timeout=20000)
            started = time.time()
            if page.query_selector("[data-offline-get='mini']"):
                page.click("[data-offline-get='mini']")
                page.wait_for_selector("[data-offline-use='mini'], .offline-progress .offline-warn", timeout=15 * 60 * 1000)
                failure = page.query_selector(".offline-progress .offline-warn")
                self.assertIsNone(failure, failure and failure.inner_text())
            print(f"\n  Glow Offline Mini ready in {time.time() - started:.0f} s")
            page.evaluate("() => document.getElementById('settings-modal').classList.remove('open')")
            page.evaluate(WAIT_FOR_WORKERS)
            context.set_offline(True)
            page.reload()
            page.wait_for_function(WAIT_FOR_CHAT, timeout=30000)
            self.assertTrue(page.evaluate(CONTINUE_AS_GUEST))
            page.wait_for_function("document.getElementById('status').textContent.startsWith(\"You're offline: Glow Offline\")", timeout=15000)
            page.evaluate("() => newChat()")
            # A cloud model is picked: with no internet GlowChat must switch to the on-device model by itself.
            self.assertEqual(page.evaluate(PICK_FREE_MODEL), "free::openai-fast")
            page.fill("#input", "Reply in one short sentence: what is the capital of Indonesia?")
            started = time.time()
            page.click("#send-btn")
            page.wait_for_function(
                "() => { const last = current.messages[current.messages.length - 1];"
                " return last && last.role === 'assistant' && !document.getElementById('send-btn').disabled; }",
                timeout=180000,
            )
            answer = page.evaluate("() => current.messages[current.messages.length - 1].content")
            print(f"  Offline answer in {time.time() - started:.1f} s: {answer[:160]!r}")
            self.assertRegex(answer, r"(?i)jakarta|nusantara")
            self.assertFalse(page.evaluate("navigator.onLine"))
            self.assertTrue(page.evaluate("window.GlowOfflineAI.isDownloaded('mini')"))
            self.assertEqual(page.evaluate("current.messages[current.messages.length - 1].model"), "local::mini")
            label = page.evaluate("() => [...document.querySelectorAll('#messages .msg.assistant .meta')].pop().textContent")
            self.assertIn("Glow Offline Mini", label, "the reply must say which model really answered")
            self.assertTrue(page.inner_text("#status").startswith("You're offline: Glow Offline"))
            context.close()
        pages.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
