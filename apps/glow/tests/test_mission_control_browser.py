"""Hermetic GlowLead browser regressions. No real AI, credentials or external requests.

Optional development dependency: playwright==1.55.0, with Chromium installed.
Run: python -X utf8 apps/glow/tests/test_mission_control_browser.py
The shipped Glow site itself still has no build step or added dependencies.
"""
import functools
import http.server
import json
import threading
import unittest
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

WEB = Path(__file__).resolve().parents[1] / "web"
ENGINE_STUB = r"""
window.__calls = [];
window.__roomCalls = [];
window.__rooms = {};
window.CrewEngine = {
  BOTS: { explore: { name: "Scout" } },
  tools: {
    chat: async (options) => {
      const config = window.__config || {};
      const kind = options.system.startsWith("You are GlowLead, the lead of a team") ? "plan"
        : options.system.includes("CHECK:") ? "review" : "work";
      window.__calls.push({ kind, content: options.messages[0].content });
      if (config.hangAll || (config.hangWork && kind === "work")) {
        return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true }));
      }
      if (kind === "plan") return JSON.stringify(config.plan || {
        summary: "A practical mission", criteria: ["Specific", "Useful"],
        steps: [{ worker: "chat", title: "Draft the result", task: "Write a useful draft" }]
      });
      if (kind === "review") return config.review || 'A clear result.\nCHECK: {"met":[true,true],"missing":""}';
      if (config.emptyWork) return "   ";
      return "A useful draft for your mission.";
    }
  },
  start: (task, options) => {
    const id = "crew-" + window.__roomCalls.length;
    window.__roomCalls.push({ task, ...options });
    const badResearch = (window.__config || {}).partialResearchFailure;
    const run = {
      id, status: "done", final: "Research findings with caveats.",
      steps: [{ bot: "explore", status: badResearch ? "error" : "done", error: badResearch ? "Search unavailable" : "",
        artifacts: badResearch ? [] : [{ type: "sources", items: [{ title: "Recorded source", url: "https://example.com/reference" }] }] }]
    };
    window.__rooms[id] = run;
    return run;
  },
  getRun: (id) => window.__rooms[id],
  stop: (id) => { if (window.__rooms[id]) window.__rooms[id].status = "stopped"; },
  on: () => {},
  openSettings: () => { window.__settingsOpened = true; },
  glow: { status: () => ({ signedIn: false }), signIn: async () => {} }
};
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


@unittest.skipUnless(sync_playwright, "Install the optional Playwright test dependency to run browser checks")
class MissionControlBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(WEB)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1100}, color_scheme="dark")
        self.errors = []
        self.context.on("page", lambda page: page.on("pageerror", lambda error: self.errors.append(str(error))))
        self.context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(self.url) else route.abort())
        self.page = self.context.new_page()

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], "No uncaught browser errors")

    def open(self, config=None, leads=None, real_engine=False):
        self.page.add_init_script("window.__config = " + json.dumps(config or {}) + ";")
        if leads is not None:
            self.page.add_init_script("localStorage.setItem('glowlead.v1', " + json.dumps(json.dumps(leads)) + ");")
        if not real_engine:
            self.context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=ENGINE_STUB))
        self.page.goto(self.url + "/lead/" + ("#selftest" if real_engine else ""))
        self.page.wait_for_function("!!window.GlowLead")

    def start(self, goal="Write a useful email", approve=False, allow_code=False):
        self.page.evaluate("args => { window.__run = GlowLead.start(args.goal, args.approve, {allowCode: args.allowCode}); }",
                           {"goal": goal, "approve": approve, "allowCode": allow_code})
        self.page.wait_for_function("GlowLead.leads.length > 0")

    def wait_done(self):
        self.page.wait_for_function("GlowLead.leads[0].status === 'done'", timeout=20000)

    def test_original_21_self_checks(self):
        self.open(real_engine=True)
        self.page.wait_for_selector("#selftest-results", timeout=25000)
        result = self.page.locator("#selftest-results").inner_text()
        self.assertNotIn("FAIL", result)
        self.assertEqual(len(result.splitlines()), 21)

    def test_default_approval_and_editable_plan(self):
        self.open()
        self.assertTrue(self.page.locator("#lead-approve").is_checked())
        self.page.fill("#lead-input", "Draft a friendly email")
        self.page.click("#lead-go")
        self.page.wait_for_selector("#approve-btn:enabled")
        self.assertEqual(self.page.evaluate("__calls.map(call => call.kind)"), ["plan"])
        self.page.fill("#edit-title-0", "My edited title")
        self.page.fill("#edit-task-0", "Use exactly two paragraphs, signed Juwen")
        self.page.fill("#edit-criteria", "Two paragraphs\nSigned Juwen")
        self.page.click("#approve-btn")
        self.wait_done()
        self.assertIn("signed Juwen", self.page.evaluate("__calls.find(call => call.kind === 'work').content"))
        self.assertEqual(self.page.evaluate("GlowLead.leads[0].criteria"), ["Two paragraphs", "Signed Juwen"])
        self.assertIn("My edited title", self.page.locator("#steps").inner_text())

    def test_review_requires_exact_booleans(self):
        self.open()
        cases = [[], [True], ["true", 1], [None, True], [True, True, True]]
        for values in cases:
            parsed = self.page.evaluate("raw => GlowLead.parseReview(raw, 2)", "Report\nCHECK: " + json.dumps({"met": values}))
            self.assertFalse(parsed["checked"], values)
        parsed = self.page.evaluate("GlowLead.parseReview('Report\\nCHECK: {\"met\":[true]}', 2)")
        self.assertIsNone(parsed["met"][1])
        self.assertEqual(self.page.evaluate("GlowLead.parsePlan('{\"steps\":[{\"worker\":\"__proto__\",\"task\":\"x\"}]}', 'x').steps[0].worker"), "chat")

    def test_missing_review_is_not_success(self):
        self.open({"review": "No structured review"})
        self.start()
        self.wait_done()
        self.assertFalse(self.page.evaluate("GlowLead.leads[0].checked"))
        self.assertEqual(self.page.evaluate("GlowLead.leads[0].met"), [None, None])
        self.assertIn("not fully checked", self.page.locator("#lead-run").text_content())
        self.assertEqual(self.page.locator("#stat-attention").inner_text(), "1")

    def test_empty_worker_reply_is_error_not_completed(self):
        self.open({"emptyWork": True})
        self.start()
        self.page.wait_for_function("GlowLead.leads[0].status === 'error'")
        self.assertEqual(self.page.evaluate("GlowLead.leads[0].steps[0].status"), "error")
        self.assertEqual(self.page.evaluate("__calls.filter(call => call.kind === 'review').length"), 0)

    def test_interrupted_mission_resumes_without_redoing_completed_steps(self):
        lead = {"id": "recover", "goal": "A saved mission", "createdAt": 1000, "status": "working", "criteria": ["Specific", "Useful"],
                "steps": [{"worker": "chat", "title": "First", "task": "Keep this", "status": "done", "output": "PRESERVED"},
                          {"worker": "chat", "title": "Second", "task": "Resume this", "status": "running", "output": ""}]}
        self.open(leads=[lead])
        self.page.wait_for_selector("#retry-btn")
        self.assertEqual(self.page.evaluate("GlowLead.leads[0].status"), "interrupted")
        self.page.click("#retry-btn")
        self.wait_done()
        self.assertEqual(self.page.evaluate("GlowLead.leads[0].steps[0].output"), "PRESERVED")
        self.assertEqual(self.page.evaluate("__calls.filter(call => call.kind === 'work').length"), 1)
        self.assertEqual(self.page.evaluate("__calls.filter(call => call.kind === 'plan').length"), 0)

    def test_duplicate_starts_and_cross_tab_runs_are_blocked(self):
        self.open({"hangAll": True})
        self.start()
        self.page.wait_for_function("__calls.length === 1")
        self.assertIsNone(self.page.evaluate("GlowLead.start('Duplicate', false)"))
        second = self.context.new_page()
        second.goto(self.url + "/lead/")
        second.wait_for_function("!!window.GlowLead")
        second.evaluate("GlowLead.start('Other tab', false)")
        second.wait_for_selector(".toast")
        self.assertIn("another tab", second.locator(".toast").last.inner_text())
        self.assertEqual(second.evaluate("__calls.length"), 0)
        self.assertEqual(self.page.evaluate("GlowLead.leads.length"), 1)
        self.page.evaluate("GlowLead.stop(GlowLead.leads[0])")
        self.page.wait_for_function("GlowLead.leads[0].status === 'stopped'")

    def test_stop_then_resume_preserves_first_step(self):
        self.open({"hangWork": True})
        self.start()
        self.page.wait_for_function("__calls.some(call => call.kind === 'work')")
        self.page.click("#stop-btn")
        self.page.wait_for_selector("#retry-btn:enabled")
        self.assertEqual(self.page.evaluate("GlowLead.leads[0].status"), "stopped")
        self.page.evaluate("__config.hangWork = false")
        self.page.click("#retry-btn")
        self.wait_done()
        self.assertEqual(self.page.evaluate("__calls.filter(call => call.kind === 'plan').length"), 1)

    def test_research_permissions_and_source_provenance(self):
        plan = {"criteria": ["Specific", "Useful"], "steps": [{"worker": "room", "title": "Research", "task": "Read sources"}]}
        self.open({"plan": plan})
        self.start()
        self.wait_done()
        bots = self.page.evaluate("__roomCalls[0].bots")
        self.assertNotIn("coder", bots)
        self.assertNotIn("tester", bots)
        self.assertIn("explore", bots)
        self.assertEqual(self.page.locator(".source-list a").get_attribute("href"), "https://example.com/reference")
        self.start("Run a calculation", allow_code=True)
        self.wait_done()
        self.assertIn("coder", self.page.evaluate("__roomCalls[1].bots"))
        self.assertIn("tester", self.page.evaluate("__roomCalls[1].bots"))

    def test_partial_crew_research_failure_cannot_pass(self):
        plan = {"criteria": ["Specific", "Useful"], "steps": [{"worker": "room", "title": "Research", "task": "Read sources"}]}
        self.open({"plan": plan, "partialResearchFailure": True})
        self.start()
        self.wait_done()
        self.assertTrue(self.page.evaluate("GlowLead.leads[0].unverified"))
        self.assertEqual(self.page.evaluate("GlowLead.leads[0].met"), [False, False])
        self.assertIn("Not checked live", self.page.locator("#lead-run").text_content())

    def test_source_urls_are_validated_and_deduplicated(self):
        self.open()
        sources = self.page.evaluate("""GlowLead.collectSources({steps:[{artifacts:[{type:'sources',items:[
          {url:'javascript:alert(1)'}, {url:'https://secret@example.com/'},
          {url:'https://example.com/',title:'a'}, {url:'https://example.com/',title:'b'}, {url:'not a url'}
        ]}]}]})""")
        self.assertEqual(sources, [{"url": "https://example.com/", "title": "b"}])

    def test_playbook_save_reuse_delete_and_permissions_reset(self):
        self.open()
        self.page.fill("#lead-input", "A reusable research brief")
        self.page.click("#save-template")
        self.page.fill("#template-name", "Research routine")
        self.page.click("#template-form button[type=submit]")
        self.assertEqual(self.page.locator("[data-template]").count(), 1)
        self.page.select_option("#execution-mode", "code")
        self.page.uncheck("#lead-approve")
        self.page.fill("#lead-input", "")
        self.page.click("[data-template]")
        self.assertEqual(self.page.locator("#lead-input").input_value(), "A reusable research brief")
        self.assertEqual(self.page.locator("#execution-mode").input_value(), "research")
        self.assertTrue(self.page.locator("#lead-approve").is_checked())
        self.page.reload()
        self.assertEqual(self.page.locator("[data-template]").count(), 1)
        self.page.click("[data-delete-template]")
        self.assertEqual(self.page.locator("[data-template]").count(), 0)

    def test_history_search_filter_and_keyboard(self):
        self.open()
        self.start("A bakery plan")
        self.wait_done()
        self.start("A printer comparison", approve=True)
        self.page.wait_for_selector("#approve-btn:enabled")
        self.page.fill("#mission-search", "bakery")
        self.assertEqual(self.page.locator("#history [data-lead]").count(), 1)
        self.page.fill("#mission-search", "")
        self.page.select_option("#mission-filter", "attention")
        self.assertEqual(self.page.locator("#history [data-lead]").count(), 1)
        self.page.fill("#lead-input", "Keyboard mission")
        self.page.locator("#lead-input").press("Control+Enter")
        self.page.wait_for_function("GlowLead.leads.length === 3")

    def test_export_contains_plan_checks_work_and_audit_no_settings(self):
        self.open()
        self.start()
        self.wait_done()
        exported = self.page.evaluate("GlowLead.missionMarkdown(GlowLead.leads[0])")
        for label in ("## Done-criteria", "## Team work", "## Activity", "## Collected sources", "not independent verification"):
            self.assertIn(label, exported)
        self.assertNotIn("apiKey", exported)
        with self.page.expect_download() as download:
            self.page.click("#export-mission")
        self.assertTrue(download.value.suggested_filename.endswith(".md"))

    def test_storage_failure_is_visible_and_preserves_memory(self):
        self.open()
        self.page.evaluate("""() => {
          Storage.prototype.setItem = function(key, value) {
            throw new DOMException('full', 'QuotaExceededError');
          };
        }""")
        self.start()
        self.wait_done()
        self.assertTrue(self.page.locator("#storage-warning").is_visible())
        self.assertEqual(self.page.evaluate("GlowLead.leads.length"), 1)
        self.assertTrue(self.page.evaluate("GlowLead.leads[0].report.length > 0"))

    def test_mobile_light_dark_and_focus_no_horizontal_overflow(self):
        self.open()
        for width in (375, 768, 1440):
            self.page.set_viewport_size({"width": width, "height": 900})
            self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width)
        self.page.click("#theme-btn")
        self.assertEqual(self.page.locator("html").get_attribute("data-theme"), "light")
        self.page.reload()
        self.assertEqual(self.page.locator("html").get_attribute("data-theme"), "light")
        self.page.keyboard.press("Tab")
        self.assertTrue(self.page.locator(".skip-link").evaluate("el => el === document.activeElement"))

    def test_handoff_starts_planning_but_waits_for_approval(self):
        self.open()
        self.page.goto(self.url + "/lead/?goal=Draft%20an%20email&go=1")
        self.page.wait_for_selector("#approve-btn:enabled")
        self.assertEqual(self.page.evaluate("__calls.map(call => call.kind)"), ["plan"])
        self.assertNotIn("goal=", self.page.url)

    def test_plan_edits_reject_empty_instructions(self):
        self.open()
        self.start(approve=True)
        self.page.wait_for_selector("#approve-btn:enabled")
        self.page.fill("#edit-task-0", "   ")
        self.page.click("#approve-btn")
        self.assertEqual(self.page.evaluate("GlowLead.leads[0].status"), "awaiting")
        self.assertEqual(self.page.evaluate("__calls.length"), 1)


    def test_reload_recovers_a_real_checkpoint(self):
        self.open({"hangWork": True})
        self.start()
        self.page.wait_for_function("__calls.some(call => call.kind === 'work')")
        self.assertEqual(self.page.evaluate("JSON.parse(localStorage.getItem('glowlead.v1'))[0].steps[0].status"), "running")
        self.page.reload()
        self.page.wait_for_selector("#retry-btn:enabled")
        self.assertEqual(self.page.evaluate("GlowLead.leads[0].status"), "interrupted")
        self.page.evaluate("__config.hangWork = false")
        self.page.click("#retry-btn")
        self.wait_done()
        self.assertEqual(self.page.evaluate("__calls.filter(call => call.kind === 'plan').length"), 0)

    def test_history_merges_other_tabs_without_losing_missions(self):
        self.open()
        self.start("First tab mission", approve=True)
        self.page.wait_for_selector("#approve-btn:enabled")
        second = self.context.new_page()
        second.goto(self.url + "/lead/")
        second.wait_for_function("!!window.GlowLead")
        second.evaluate("GlowLead.start('Second tab mission', true)")
        second.wait_for_selector("#approve-btn:enabled")
        self.page.wait_for_function("GlowLead.leads.length === 2")
        self.assertEqual(set(self.page.evaluate("GlowLead.leads.map(lead => lead.goal)")), {"First tab mission", "Second tab mission"})
        stored = self.page.evaluate("JSON.parse(localStorage.getItem('glowlead.v1')).map(lead => lead.goal)")
        self.assertEqual(len(stored), 2)



    def test_mobile_plan_editor_and_unfinished_export(self):
        self.open()
        self.page.set_viewport_size({"width": 375, "height": 812})
        self.start(approve=True)
        self.page.wait_for_selector("#approve-btn:enabled")
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.assertTrue(self.page.locator("#edit-task-0").is_visible())
        exported = self.page.evaluate("GlowLead.missionMarkdown(GlowLead.leads[0])")
        self.assertIn("No final report yet", exported)
        self.assertIn("waiting for your approval", exported)


if __name__ == "__main__":
    unittest.main(verbosity=2)
