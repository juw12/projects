"""Glow 1.29: the offline library (reference packs on the device, cited in offline answers).

Static checks always run. Browser checks need Playwright; they serve apps/glow/web locally, download the
packs into the browser, search them, and answer with no internet (with no AI model, and with a stand-in
for Glow Offline so no GPU is needed).
Run from the repo root:  python -X utf8 apps/glow/tests/test_glow_library.py
"""
import json
import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS))
sys.path.insert(0, str(TESTS.parent / "tools"))

import build_library  # noqa: E402
from test_glow_offline import (  # noqa: E402
    CHAT_PAGES,
    CONTINUE_AS_GUEST,
    HAVE_PLAYWRIGHT,
    PICK_FREE_MODEL,
    WAIT_FOR_CHAT,
    WEB,
    GlowPagesServer,
    launch_browser,
    read,
)

if HAVE_PLAYWRIGHT:
    from playwright.sync_api import sync_playwright

LIBRARY = WEB / "library"


class LibraryStatic(unittest.TestCase):
    def test_builder_selftest(self):
        build_library.selftest()

    def test_packs_match_the_index(self):
        index = json.loads((LIBRARY / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["format"], 1)
        self.assertIn("CC BY-SA", index["license"])
        self.assertEqual({p["id"] for p in index["packs"]}, set(build_library.PACKS))
        for entry in index["packs"]:
            path = LIBRARY / entry["file"]
            pack = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(pack["id"], entry["id"])
            self.assertEqual(pack["format"], 1)
            self.assertEqual(entry["bytes"], path.stat().st_size, f"{entry['id']}: rebuild index.json")
            self.assertEqual(entry["articles"], len(pack["articles"]))
            self.assertEqual(entry["passages"], len(pack["chunks"]))
            self.assertGreaterEqual(len(pack["articles"]), 25, f"{entry['id']} lost too many articles")
            self.assertLess(entry["bytes"], 6e6, f"{entry['id']} is too big for a phone download")
            for article in pack["articles"]:
                self.assertTrue(article["url"].startswith("https://en.wikipedia.org/wiki/"), article)
            for chunk in pack["chunks"]:
                self.assertIn(chunk["a"], range(len(pack["articles"])))
                self.assertLessEqual(len(chunk["t"]), build_library.CHUNK_CHARS + 400)
                self.assertNotRegex(chunk["t"], r"\[\d+\]", "citation marks must be stripped")

    def test_glowchat_wiring(self):
        for page in CHAT_PAGES:
            html = read(f"chat/{page}")
            self.assertIn('id="offline-library-panel"', html, page)
            self.assertLess(html.index("glow-offline-library.js"), html.index('src="./app.js"'), page)
        app = read("chat/app.js")
        self.assertIn('if (provider === "library") return await streamLibrary(', app)
        self.assertIn("libraryContext(messages", app)
        self.assertIn("library.footer", app)
        self.assertIn("'../shared/glow-offline-library.js'", read("chat/sw.js"))
        self.assertIn('"local", "library"]', read("shared/glow-locale.js"), "the offline library must never be region-filtered")
        library = read("shared/glow-offline-library.js")
        self.assertIn("window.GlowLibrary", library)
        self.assertIn('new URL("../library/", SCRIPT_URL)', library, "packs come from Glow's own site, not a third party")


# Download every pack from the local server into this browser.
INSTALL_ALL = """
async () => {
  const packs = await GlowLibrary.catalog();
  for (const pack of packs) await GlowLibrary.install(pack.id);
  return GlowLibrary.installed().map((p) => p.id).sort();
}
"""
SEARCH = "async (query) => (await GlowLibrary.search(query, { limit: 3 })).map((r) => r.title)"

# Glow Offline needs WebGPU; this stand-in records what the app sends and answers at once.
FAKE_GLOW_OFFLINE = """
() => {
  const ai = window.GlowOfflineAI;
  const model = ai.models[0];
  ai.downloaded = () => [{ ...model }];
  ai.isDownloaded = () => true;
  ai.prepare = () => {};
  ai.chat = async ({ messages, onText }) => {
    window.__sentToModel = messages;
    onText("Get them somewhere warm and dry [1].");
    return { text: "Get them somewhere warm and dry [1].", usage: null };
  };
  return model.key;
}
"""


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run browser checks")
class LibraryInBrowser(unittest.TestCase):
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

    def open_chat(self):
        context = self.browser.new_context()
        page = context.new_page()
        page.goto(self.pages.base + "chat/")
        page.wait_for_function(WAIT_FOR_CHAT, timeout=20000)
        self.assertTrue(page.evaluate(CONTINUE_AS_GUEST))
        return context, page

    def test_search_finds_the_right_articles(self):
        context, page = self.open_chat()
        self.assertEqual(page.evaluate(INSTALL_ALL), sorted(build_library.PACKS))
        expected = {
            "How do I purify water to drink?": {"Water purification", "Portable water purification", "Boiling", "Drinking water", "Water chlorination", "Solar water disinfection"},
            "signs of hypothermia": {"Hypothermia"},
            "how to treat a snake bite": {"Snakebite"},
            "someone is choking": {"Choking", "Abdominal thrusts"},
            "how to do CPR": {"Cardiopulmonary resuscitation"},
            "what to do during an earthquake": {"Earthquake preparedness", "Earthquake"},
            "how to stop heavy bleeding": {"Bleeding", "Tourniquet", "Pressure dressing", "First aid"},
            "how to start a fire without matches": {"Fire making", "Bow drill", "Fire striker", "Campfire", "Survival skills"},
            "carbon monoxide symptoms": {"Carbon monoxide poisoning"},
            "how to find north without a compass": {"Navigation", "Celestial navigation", "Orienteering", "Compass", "Survival skills"},
            "someone fainted and is not breathing": {"Respiratory arrest", "Syncope (medicine)", "Cardiopulmonary resuscitation", "Cardiac arrest"},
            "how to do cpr on an adult": {"Cardiopulmonary resuscitation", "Basic life support"},
            # Indonesian questions (Glow's Indonesian interface) map common emergency words to the English packs.
            "bagaimana cara mengobati luka bakar": {"Burn"},
            "teman saya pingsan dan tidak bernapas": {"Respiratory arrest", "Syncope (medicine)", "Cardiopulmonary resuscitation", "Cardiac arrest"},
            "digigit ular": {"Snakebite"},
            "gejala dehidrasi": {"Dehydration"},
        }
        misses = {}
        for query, titles in expected.items():
            found = page.evaluate(SEARCH, query)
            if not found or found[0] not in titles:
                misses[query] = found
        self.assertEqual(misses, {}, "top result should be one of the expected articles")
        # Everyday requests must not drag survival passages into the answer.
        for query in [
            "rewrite my email so it sounds friendlier",
            "translate good morning into French",
            "write a poem about my cat",
            "summarize this article for me",
            "what's a good name for my startup",
            "tolong buatkan puisi tentang kucing",
        ]:
            self.assertEqual(page.evaluate(SEARCH, query), [], query)
        context.close()

    def test_offline_with_no_model_answers_from_the_library(self):
        context, page = self.open_chat()
        page.evaluate("async () => { await GlowLibrary.install('first-aid'); await loadModels(); }")
        self.assertEqual(page.evaluate(PICK_FREE_MODEL), "free::openai-fast")
        context.set_offline(True)
        page.fill("#input", "How do I treat hypothermia?")
        page.click("#send-btn")
        page.wait_for_function("document.body.innerText.includes('Offline library sources')", timeout=15000)
        reply = page.evaluate("current.messages[current.messages.length - 1].content")
        self.assertIn("From the offline library on this device", reply)
        self.assertIn("https://en.wikipedia.org/wiki/Hypothermia", reply)
        self.assertIn("not medical advice", reply)
        context.close()

    def test_glow_offline_reads_the_passages_and_cites_them(self):
        context, page = self.open_chat()
        page.evaluate("async () => { await GlowLibrary.install('first-aid'); }")
        key = page.evaluate(FAKE_GLOW_OFFLINE)
        page.evaluate("async () => { await loadModels(); }")
        self.assertEqual(page.evaluate(PICK_FREE_MODEL), "free::openai-fast")
        context.set_offline(True)
        page.fill("#input", "My friend is shivering and confused after falling in a cold lake. What do I do?")
        page.click("#send-btn")
        page.wait_for_function("document.body.innerText.includes('Offline library sources')", timeout=15000)
        system = page.evaluate("window.__sentToModel[0].content")
        self.assertIn("Reference passages from the offline library", system)
        self.assertIn("Hypothermia", system)
        self.assertLess(len(system), 1200 + 3400, "the prompt must fit the small model's working memory")
        reply = page.evaluate("current.messages[current.messages.length - 1].content")
        self.assertTrue(reply.startswith("Get them somewhere warm and dry [1]."))
        self.assertIn("[1] [Hypothermia](https://en.wikipedia.org/wiki/Hypothermia)", reply)
        self.assertEqual(page.evaluate("current.messages[current.messages.length - 1].model || ''").split("::")[0] in ("local", "free", ""), True)
        self.assertTrue(key)
        context.close()

    def test_settings_panel_and_switch(self):
        context, page = self.open_chat()
        page.evaluate("openSettings()")
        page.wait_for_selector("#offline-library-panel [data-library-get='first-aid']", timeout=15000)
        page.click("#offline-library-panel [data-library-get='first-aid']")
        page.wait_for_selector("#offline-library-panel [data-library-remove='first-aid']", timeout=20000)
        self.assertTrue(page.evaluate("GlowLibrary.hasPacks() && libraryReady()"))
        page.uncheck("#library-on")
        self.assertTrue(page.evaluate("state.settings.libraryOff === true && !libraryReady()"))
        context.set_offline(True)
        self.assertIn("download Glow Offline", page.evaluate("offlineStatusText()"))
        page.check("#library-on")
        self.assertIn("offline library", page.evaluate("offlineStatusText()"))
        context.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
