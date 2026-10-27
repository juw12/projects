"""1.20.2 regression checks: "Thinking…" indicator while a model works before its first word (stdlib only)."""
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web" / "chat"


class ThinkingIndicatorTests(unittest.TestCase):
    def setUp(self):
        self.script = (WEB / "app.js").read_text(encoding="utf-8")
        self.styles = (WEB / "styles.css").read_text(encoding="utf-8")

    def test_waiting_helper_shows_status_and_timer(self):
        helper = re.search(r"function startWaiting\(bubble\) \{([\s\S]+?)\n\}", self.script).group(1)
        self.assertIn('role="status"', helper)
        self.assertIn("Thinking…", helper)
        self.assertIn("Still thinking…", helper)
        self.assertIn("clearInterval(timer)", helper)

    def test_every_streaming_bubble_uses_the_indicator(self):
        # Chat replies, Arena slots and the fused Arena answer all start with the placeholder.
        self.assertEqual(self.script.count("= startWaiting("), 3)

    def test_empty_updates_do_not_wipe_the_indicator(self):
        self.assertIn("if (!full) return;", self.script)
        self.assertIn("if (full) bubble.innerHTML = renderReply(full);", self.script)
        self.assertIn("if (full) bubbles[slot].innerHTML = renderReply(full);", self.script)

    def test_stop_never_saves_the_placeholder_as_the_reply(self):
        self.assertIn('return isWaiting(bubble) ? "" : bubble.textContent;', self.script)
        self.assertNotIn('error.name === "AbortError" ? bubble.textContent', self.script)
        self.assertNotIn('error.name === "AbortError" ? bubbles[slot].textContent', self.script)

    def test_styles_hide_cursor_and_respect_reduced_motion(self):
        self.assertIn(".cursor:has(.waiting)::after { content: none; }", self.styles)
        self.assertIn("@keyframes waiting-pulse", self.styles)
        self.assertIn("prefers-reduced-motion", self.styles)


if __name__ == "__main__":
    unittest.main()
