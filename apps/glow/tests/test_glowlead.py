"""Static checks for GlowLead, the lead (orchestrator) of the Glow apps."""
import json
import re
import unittest
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
LEAD = WEB / "lead"


class GlowLeadTests(unittest.TestCase):
    def test_files_exist(self):
        for name in ("index.html", "lead.css", "lead.js", "manifest.webmanifest", "sw.js", "icons/lead-icon.svg"):
            self.assertTrue((LEAD / name).is_file(), name)

    def test_page_loads_shared_switcher_and_room_engine(self):
        page = (LEAD / "index.html").read_text(encoding="utf-8")
        order = [page.index(src) for src in ('src="../shared/glow-apps.js"', 'src="../room/crew-engine.js"', 'src="./lead.js"')]
        self.assertEqual(order, sorted(order), "switcher and GlowRoom engine must load before lead.js")
        self.assertIn('id="lead-input"', page)
        self.assertIn('id="lead-approve"', page)
        self.assertIn("data-glow-apps", page)

    def test_plan_delegate_check_loop(self):
        script = (LEAD / "lead.js").read_text(encoding="utf-8")
        for needle in ("PLAN_SYSTEM", "REVIEW_SYSTEM", "runChatStep", "runCouncilStep", "runRoomStep",
                       "CHECK:", "lead.fixed", 'source: "glowlead"', 'from: "glowlead"', "#selftest"):
            self.assertIn(needle, script)
        self.assertIn("const MAX_STEPS = 4;", script)

    def test_failed_research_is_never_hidden(self):
        script = (LEAD / "lead.js").read_text(encoding="utf-8")
        for needle in ("function failedResearch", "Do not invent", "research FAILED", "lead.unverified",
                       "Not checked live", "Redo the live research", "sends the mission again"):
            self.assertIn(needle, script)
        engine = (WEB / "room" / "crew-engine.js").read_text(encoding="utf-8")
        for needle in ("function waitAfterEmpty", "Planner busy, so Nova uses a standard plan",
                       "Nova could not write a summary"):
            self.assertIn(needle, engine)

    def test_glow_free_always_gets_an_answer(self):
        # Glow Free runs a reasoning model: at default effort it often thinks, then sends no answer text,
        # and identical requests are cached, so an unchanged retry repeats the same empty reply.
        engine = (WEB / "room" / "crew-engine.js").read_text(encoding="utf-8")
        self.assertIn("body.reasoning_effort = 'low';", engine)
        self.assertIn("if (emptyRetries < 2) body.seed = Math.floor(Math.random() * 1e9);", engine)

    def test_worker_cache_is_scoped(self):
        worker = (LEAD / "sw.js").read_text(encoding="utf-8")
        self.assertIn("const CACHE_NAME = 'glowlead-v16';", worker)
        self.assertIn("name.startsWith('glowlead-')", worker)
        self.assertNotIn("caches.keys().then((names) => Promise.all(names.map", worker)
        home_worker = (WEB / "sw.js").read_text(encoding="utf-8")
        self.assertIn("scope + 'lead/'", home_worker, "Glow home's worker must leave GlowLead alone")

    def test_manifest(self):
        manifest = json.loads((LEAD / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["short_name"], "GlowLead")
        self.assertEqual(manifest["start_url"], "./")

    def test_ecosystem_links(self):
        switcher = (WEB / "shared/glow-apps.js").read_text(encoding="utf-8")
        self.assertIn('id: "lead", name: "GlowLead"', switcher)
        home = (WEB / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="start-lead"', home)
        self.assertIn('id="open-lead"', home)
        for page in ("index.html", "app.html", "mobile.html"):
            chat = (WEB / "chat" / page).read_text(encoding="utf-8")
            self.assertIn('id="glowlead-link" href="../lead/"', chat, page)
        room = (WEB / "room/cinema.js").read_text(encoding="utf-8")
        self.assertIn("Owner: GlowLead", room)
        self.assertIn('href="../lead/"', (WEB / "room/mobile.html").read_text(encoding="utf-8"))

    def test_glowchat_keeps_glowlead_source(self):
        app = (WEB / "chat/app.js").read_text(encoding="utf-8")
        self.assertIn('item.source === "glowlead" ? "glowlead" : "crewroom"', app)
        self.assertIn('name: "👑 GlowLead"', app)

    def test_engine_never_waits_forever(self):
        engine = (WEB / "room/crew-engine.js").read_text(encoding="utf-8")
        for needle in ("REQUEST_TIMEOUT_MS = 75000", "STALL_TIMEOUT_MS = 45000", "function requestTimer(", "timer.arm(STALL_TIMEOUT_MS)"):
            self.assertIn(needle, engine)

    def test_engine_merges_missions_from_other_pages(self):
        engine = (WEB / "room/crew-engine.js").read_text(encoding="utf-8")
        self.assertIn("function mergeStoredRuns()", engine)
        self.assertRegex(engine, re.compile(r"persist\(\) \{[\s\S]{0,200}mergeStoredRuns\(\)"))


if __name__ == "__main__":
    unittest.main()
