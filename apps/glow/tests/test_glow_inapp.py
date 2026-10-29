"""Static checks: Glow versions with in-app updates, and GlowRoom kept inside the app."""
import json
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
WEB = APP / "web"


class GlowInAppTests(unittest.TestCase):
    def setUp(self):
        self.switcher = (WEB / "shared" / "glow-apps.js").read_text(encoding="utf-8")

    def test_version_matches_release_file(self):
        release = json.loads((WEB / "version.json").read_text(encoding="utf-8"))
        built_in = re.search(r'const GLOW_VERSION = "([^"]+)";', self.switcher).group(1)
        self.assertEqual(release["version"], built_in, "bump version.json and GLOW_VERSION together")
        package = json.loads((APP / "mobile" / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], built_in, "the Android app carries the same Glow version")
        self.assertTrue(release["notes"], "version.json needs release notes for the update bar")
        self.assertIn("releases/download/glow-android/Glow-android.apk", release["android"])

    def test_update_flow(self):
        for needle in ("function checkForUpdate", "function applyUpdate", 'cache: "no-store"', 'cache: "reload"',
                       "caches.delete", "registration.update()", "Update now", "Download update",
                       "glow-apps-version", "data-glow-version", "LIVE_ROOT + \"version.json\""):
            self.assertIn(needle, self.switcher)

    def test_glowroom_opens_inside_the_app(self):
        for needle in ("function openRoomPanel", "function openApp", "window.open = function",
                       '"glow-room-goal"', "glow-room-panel", "glow-embedded"):
            self.assertIn(needle, self.switcher)
        self.assertIn("'glow-room-goal'", (WEB / "room" / "cinema.js").read_text(encoding="utf-8"))
        self.assertIn("'glow-room-goal'", (WEB / "room" / "mobile.html").read_text(encoding="utf-8"))
        for page in ("index.html", "app.html", "mobile.html"):
            html = (WEB / "chat" / page).read_text(encoding="utf-8")
            self.assertIn("frame-src 'self'", html, f"GlowChat {page} must allow the GlowRoom panel")

    def test_every_app_loads_the_switcher(self):
        for page in ("index.html", "chat/index.html", "chat/app.html", "chat/mobile.html", "lead/index.html",
                     "room/index.html", "room/mobile.html", "setup/index.html", "account/index.html"):
            self.assertIn("shared/glow-apps.js", (WEB / page).read_text(encoding="utf-8"), page)


    def test_profile_and_settings_everywhere(self):
        for needle in ("function mountProfile", "data-glow-profile", "function accountUrl", "Profile &amp; settings"):
            self.assertIn(needle, self.switcher)
        for page in ("index.html", "chat/index.html", "chat/app.html", "chat/mobile.html", "lead/index.html",
                     "room/mobile.html", "account/index.html"):
            self.assertIn("data-glow-profile", (WEB / page).read_text(encoding="utf-8"), page)
        self.assertIn("gr-profile-btn", (WEB / "room" / "glow-room-ui.js").read_text(encoding="utf-8"))
        account = (WEB / "account" / "index.html").read_text(encoding="utf-8")
        for section in ('id="account"', 'id="persona"', 'id="usage"', 'id="prefs"', 'id="data"', 'id="about"'):
            self.assertIn(section, account)
        self.assertIn("'account'", (WEB.parent / "mobile" / "scripts" / "build-web.mjs").read_text(encoding="utf-8"))

    def test_expired_puter_session_is_shared(self):
        # An expired Puter session must read as signed out in every app, not as signed in.
        self.assertIn('settings.puterSession === false', self.switcher)
        self.assertIn("Sign in again", self.switcher)
        chat = (WEB / "chat" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function recordPuterSession", chat)
        self.assertIn('"puterSession"', chat)
        account = (WEB / "account" / "account.js").read_text(encoding="utf-8")
        self.assertIn("puterSession: false", account)
        self.assertNotIn('if (s.account === "puter") saveSettings({ account: "guest"', account)

    def test_version_button_and_updates_by_themselves(self):
        for needle in ("function mountVersionChip", "data-glow-version-chip", "data-glow-version-slot", "Update to ",
                       "function maybeAutoUpdate", "function registerBusyCheck", "glow.update.auto", "function triedRecently",
                       "function showWhatsNew", "function announceUpdate", "glow-update-ready", "Install updates by itself"):
            self.assertIn(needle, self.switcher)
        for page in ("index.html", "app.html", "mobile.html"):
            html = (WEB / "chat" / page).read_text(encoding="utf-8")
            self.assertIn("data-glow-version-slot", html, f"GlowChat {page} needs a spot for the version button")
        chat = (WEB / "chat" / "app.js").read_text(encoding="utf-8")
        self.assertIn("registerBusyCheck", chat, "GlowChat must say when an update has to wait (a reply is streaming)")
        self.assertIn('dataset.glowDraft = "saved"', chat, "the message box keeps its text through an update")
        home_worker = (WEB / "sw.js").read_text(encoding="utf-8")
        self.assertIn("new URL('version.json', scope)", home_worker, "version.json must never come from a cache")

    def test_reopen_where_you_left_off(self):
        resume = (WEB / "shared" / "glow-resume.js").read_text(encoding="utf-8")
        for needle in ("glow.lastPlace", "glow.session", '"glow.resume"', "location.replace", 'navigation.type !== "navigate"',
                       "new URL(document.referrer).origin === location.origin"):
            self.assertIn(needle, resume)
        home = (WEB / "index.html").read_text(encoding="utf-8")
        self.assertLess(home.index("shared/glow-resume.js"), home.index("</head>"), "it must run before Glow home is drawn")
        self.assertIn("./shared/glow-resume.js", (WEB / "sw.js").read_text(encoding="utf-8"), "and work offline")
        for needle in ("function recordPlace", "data-glow-resume-toggle", "function showResumeHint"):
            self.assertIn(needle, self.switcher)
        chat = (WEB / "chat" / "app.js").read_text(encoding="utf-8")
        for needle in ("function resumeLastChat", "if (!resumeLastChat()) newChat();", "function restoreDraft", '"glow.chat.draft"',
                       "rememberOpenChat(conv);", "clearDraft();"):
            self.assertIn(needle, chat)

    def test_used_up_allowance_never_warns_in_chats(self):
        chat = (WEB / "chat" / "app.js").read_text(encoding="utf-8")
        # The rest is kept in memory too (full browser storage), and a request already on its way when the
        # allowance ran out is answered by the backup instead of showing the warning.
        for needle in ("let puterRestUntil = 0;", "Math.max(puterRestUntil, saved)", "function puterAllowanceError",
                       "for (const backupModel of allowanceBackupModels())", "function mediaErrorText"):
            self.assertIn(needle, chat)
        self.assertNotIn("&& !puterAllowanceResting();\n    if (quietRetry)", chat)


if __name__ == "__main__":
    unittest.main()
