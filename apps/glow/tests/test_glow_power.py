"""1.24.0 checks: low power mode, the main AI service switch, the Pollinations wallet and Chrome's built-in AI (stdlib only).

The behaviour itself is covered by GlowChat's built-in self-test (chat/#selftest); these checks keep the pieces wired together.
"""
import json
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
CHAT_PAGES = ("index.html", "app.html", "mobile.html")
SERVICES = ("auto", "puter", "pollinations", "keys", "device")


class PowerAndServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.chat = (WEB / "chat" / "app.js").read_text(encoding="utf-8")
        cls.styles = (WEB / "chat" / "styles.css").read_text(encoding="utf-8")
        cls.pages = {page: (WEB / "chat" / page).read_text(encoding="utf-8") for page in CHAT_PAGES}

    def test_every_chat_page_has_the_power_switch_and_service_settings(self):
        for page, html in self.pages.items():
            for element_id in (
                "power-btn",
                "set-ai-service",
                "ai-service-note",
                "set-lowpower",
                "pollinations-status",
                "pollinations-connect",
                "pollinations-disconnect",
                "chrome-ai-status",
                "chrome-ai-get",
            ):
                self.assertEqual(html.count(f'id="{element_id}"'), 1, f"{page}: #{element_id}")
            self.assertIn('<span class="power-icon">', html, page)
            self.assertIn('<span class="power-text">', html, page)
            # The power switch sits next to the token counter in the composer.
            tools = html[html.index('id="composer-tools"'):html.index('id="usage-pop"')]
            self.assertIn('id="power-btn"', tools, page)
            options = re.findall(r'<option value="([a-z]+)"', html[html.index('id="set-ai-service"'):])[: len(SERVICES)]
            self.assertEqual(tuple(options), SERVICES, page)

    def test_service_choices_match_the_app(self):
        block = self.chat[self.chat.index("const AI_SERVICES = {"):self.chat.index("const ALWAYS_AVAILABLE_PROVIDERS")]
        self.assertEqual(tuple(re.findall(r"^  ([a-z]+): \{", block, re.M)), SERVICES)
        self.assertIn('const ALWAYS_AVAILABLE_PROVIDERS = ["demo", "local", "chrome"];', self.chat)
        self.assertIn('aiService: "auto"', self.chat)
        self.assertIn("lowPower: false", self.chat)

    def test_low_power_limits_tokens_and_history(self):
        self.assertIn("const LOW_POWER_MAX_TOKENS = 600;", self.chat)
        self.assertIn("const LOW_POWER_CONTEXT_CHARS = 6000;", self.chat)
        self.assertIn("function historyForRequest(", self.chat)
        self.assertIn("max_tokens", self.chat)
        self.assertIn("function puterChatOptions(", self.chat)

    def test_pollinations_wallet_uses_the_official_endpoints(self):
        self.assertIn('"https://enter.pollinations.ai/authorize"', self.chat)
        self.assertIn('"https://gen.pollinations.ai/v1"', self.chat)
        # Glow's publishable App Key (never a secret sk_ key).
        self.assertRegex(self.chat, r'const POLLINATIONS_APP_KEY = "pk_[A-Za-z0-9]{8,}";')
        self.assertIn("function takePollinationsKey(", self.chat)
        # The key returned in the address bar is removed right away.
        self.assertIn("history.replaceState", self.chat[self.chat.index("function takePollinationsKey("):])
        # The return address drops a trailing index.html, so it matches the addresses registered with the App Key.
        self.assertIn('location.pathname.replace(/\\/index\\.html$/, "/")', self.chat)
        self.assertIn("redirect_uri: pollinationsReturnUrl()", self.chat)

    def test_on_device_ai_rescues_cloud_failures(self):
        self.assertIn('const CHROME_AI_MODEL = { value: "chrome::gemini-nano"', self.chat)
        self.assertIn("function rescueModelFor(", self.chat)
        self.assertIn("window.LanguageModel", self.chat)

    def test_self_test_covers_the_new_features(self):
        for name in (
            "low power: replies are capped and asked to be short, without follow-ups",
            "low power: only the latest messages are sent, long ones shortened",
            "service: on this device only never sends anything to the cloud",
            "chrome ai: Gemini Nano answers on this device with the chat so far",
            "pollinations: a key without the matching sign-in check is refused",
            "pollinations: the return address never ends in index.html, so it matches Glow's registered addresses",
        ):
            self.assertIn(name, self.chat)

    def test_styles_and_translations(self):
        for selector in (".power-chip", ".power-chip.on", ".service-box"):
            self.assertIn(selector, self.styles)
        for lang in ("id", "zh-CN", "zh-TW"):
            strings = (WEB / "shared" / "i18n" / f"ui.{lang}.js").read_text(encoding="utf-8")
            for phrase in ("Full power", "Low power", "AI service & power", "Connect Pollinations", "Download in Chrome"):
                self.assertIn(json.dumps(phrase, ensure_ascii=False), strings, f"{lang}: {phrase}")

    def test_version_and_cache_were_bumped_together(self):
        published = json.loads((WEB / "version.json").read_text(encoding="utf-8"))["version"]
        self.assertEqual(published, "1.27.3")
        apps = (WEB / "shared" / "glow-apps.js").read_text(encoding="utf-8")
        self.assertIn(f'const GLOW_VERSION = "{published}";', apps)
        mobile = json.loads((APP / "mobile" / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(mobile["version"], published)
        worker = (WEB / "chat" / "sw.js").read_text(encoding="utf-8")
        self.assertIn("const CACHE_NAME = 'glowchat-v23';", worker)


if __name__ == "__main__":
    unittest.main()
