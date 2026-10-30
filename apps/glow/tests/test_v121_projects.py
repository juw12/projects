"""1.23.0 checks: projects and skills, image/video modes, allowance fallback, agent bubble, donation links (stdlib only)."""
import json
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"


class V121Tests(unittest.TestCase):
    def setUp(self):
        self.chat = (WEB / "chat" / "app.js").read_text(encoding="utf-8")
        self.apps = (WEB / "shared" / "glow-apps.js").read_text(encoding="utf-8")

    def test_versions_match(self):
        published = json.loads((WEB / "version.json").read_text(encoding="utf-8"))["version"]
        self.assertEqual(published, "1.28.1")
        self.assertIn(f'const GLOW_VERSION = "{published}";', self.apps)

    def test_every_chat_page_has_project_and_skill_buttons(self):
        for page in ("index.html", "app.html", "mobile.html"):
            html = (WEB / "chat" / page).read_text(encoding="utf-8")
            self.assertIn('id="new-project-btn"', html, page)
            self.assertIn('id="skills-btn"', html, page)

    def test_projects_and_skills_reach_the_prompt_and_sync(self):
        self.assertIn("withInstructions(personaFor(personaKey).prompt) + projectContext(conv)", self.chat)
        self.assertIn("projects: state.projects, skills: state.skills", self.chat)
        self.assertIn("state.projects = mergeById(state.projects, data.projects, deleted);", self.chat)
        self.assertIn("state.skills = mergeById(state.skills, data.skills, deleted);", self.chat)

    def test_image_and_video_are_separate_modes(self):
        self.assertIn('{ key: "media", icon: "🎨", label: "Image"', self.chat)
        self.assertIn('{ key: "video", icon: "🎬", label: "Video"', self.chat)
        self.assertIn('if (provider === "putervid") return await generateVideo(', self.chat)
        self.assertIn("sdk.ai.txt2vid(prompt", self.chat)
        # Videos are only ever shown from https links, never resent to the model as text.
        self.assertIn(".replace(VIDEO_MARKDOWN, \"[video]\")", self.chat)

    def test_media_models_never_become_text_defaults(self):
        self.assertNotRegex(self.chat, r'startsWith\("puterimg::"\)\) return 1000')
        self.assertIn("if (isMediaModel(value)) return 1000;", self.chat)

    def test_allowance_used_up_is_handled_quietly(self):
        reply = re.search(r"async function streamReply[\s\S]+?\n\}", self.chat).group(0)
        self.assertIn("puterAllowanceError(modelValue, error)", reply)
        self.assertIn("ALLOWANCE_GONE.test(errorText(error))", self.chat)
        self.assertIn("restPuterAllowance();", reply)
        assistant = re.search(r"async function streamAssistant[\s\S]+?\nconst ALLOWANCE_GONE", self.chat).group(0)
        self.assertNotIn("fillSelect", assistant)
        self.assertNotIn("toast(", assistant)
        self.assertIn('if (provider === "puter" && puterAllowanceResting()) return allowanceBackupModel().value;', self.chat)
        backup = re.search(r"function allowanceBackupModels\(\) \{([\s\S]+?)\n\}", self.chat).group(1)
        self.assertIn("chain.push(FREE_MODEL);", backup)  # Glow Free is always the last free backup

    def test_free_key_providers_and_backup(self):
        self.assertIn('const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai";', self.chat)
        self.assertIn('const GROQ_URL = "https://api.groq.com/openai/v1";', self.chat)
        self.assertIn('const MISTRAL_URL = "https://api.mistral.ai/v1";', self.chat)
        self.assertIn("function allowanceBackupModel()", self.chat)
        for page in ("index.html", "app.html", "mobile.html"):
            html = (WEB / "chat" / page).read_text(encoding="utf-8")
            self.assertIn('id="set-gemini"', html, page)
            self.assertIn('id="set-groq"', html, page)
            self.assertIn("media-src 'self' https: blob: data:", html, page)

    def test_puter_usage_dialog_is_hidden(self):
        self.assertIn('querySelectorAll("usage-limit-dialog")', self.apps)
        self.assertIn("quietPuterDialogs();", self.apps)

    def test_agent_bubble_and_donations(self):
        self.assertIn("function mountWidget()", self.apps)
        self.assertIn('currentApp() === "lead"', self.apps)
        self.assertIn("const DONATE_LINKS = [", self.apps)
        self.assertIn('/^https:\\/\\//.test(link.url || "")', self.apps)
        manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertTrue(any(s["url"] == "./lead/" for s in manifest["shortcuts"]))


if __name__ == "__main__":
    unittest.main()
