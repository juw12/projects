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
        self.page.wait_for_function("GlowLead.leads[0] && GlowLead.leads[0].status === 'done'", timeout=20000)

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



    # ---------------------------------------------------------------- v0.9: memory, follow-ups, skills, automations
    def seed(self, key, value, only_if_missing=True):
        guard = "if (!localStorage.getItem(k)) " if only_if_missing else ""
        self.context.add_init_script(
            "(() => { if (location.protocol !== 'http:') return; const k = " + json.dumps(key) + "; " + guard +
            "localStorage.setItem(k, " + json.dumps(json.dumps(value)) + "); })();")

    def test_memory_reaches_planner_and_workers_and_can_be_turned_off(self):
        self.open()
        self.page.click("#memory-btn")
        self.page.fill("#memory-about", "Engineer in Batam. Budgets in rupiah.")
        self.page.fill("#memory-notes", "Owns a Bambu A1 mini")
        self.page.click("#memory-form button[type=submit]")
        self.assertIn("Batam", self.page.locator("#memory-summary").inner_text())
        self.page.uncheck("#lead-approve")
        self.page.fill("#lead-input", "Plan a weekend project")
        self.page.click("#lead-go")
        self.wait_done()
        plan_prompt = self.page.evaluate("__calls.find(call => call.kind === 'plan').content")
        work_prompt = self.page.evaluate("__calls.find(call => call.kind === 'work').content")
        for prompt in (plan_prompt, work_prompt):
            self.assertIn("Budgets in rupiah", prompt)
            self.assertIn("Bambu A1 mini", prompt)
        self.assertIn("Memory used", self.page.locator("#lead-run").text_content())
        self.page.evaluate("__calls.length = 0")
        self.page.uncheck("#use-memory")
        self.page.fill("#lead-input", "Another mission")
        self.page.click("#lead-go")
        self.page.wait_for_function("GlowLead.leads.length === 2 && GlowLead.leads[0].status === 'done'")
        self.assertNotIn("rupiah", self.page.evaluate("__calls.map(call => call.content).join(' ')"))

    def test_follow_up_carries_previous_result(self):
        self.open()
        self.start("Draft a bakery plan")
        self.wait_done()
        self.page.uncheck("#lead-approve")
        self.page.fill("#followup-input", "Make it cheaper")
        self.page.click("#followup-form button[type=submit]")
        self.page.wait_for_function("GlowLead.leads.length === 2 && GlowLead.leads[0].status === 'done'")
        follow = self.page.evaluate("GlowLead.leads[0]")
        self.assertEqual(follow["goal"], "Make it cheaper")
        self.assertEqual(follow["parentId"], self.page.evaluate("GlowLead.leads[1].id"))
        plan_prompt = self.page.evaluate("__calls.filter(call => call.kind === 'plan').pop().content")
        self.assertIn("Draft a bakery plan", plan_prompt)
        self.assertIn("A clear result", plan_prompt)
        self.assertIn("Follow-up to", self.page.locator("#lead-run").text_content())

    def test_skill_reuses_approved_plan_without_replanning(self):
        self.open()
        self.start("Compare two printers")
        self.wait_done()
        self.page.click("#skill-btn")
        self.page.fill("#template-name", "Printer compare")
        self.page.click("#template-form button[type=submit]")
        self.assertEqual(self.page.locator(".skill-tag").count(), 1)
        self.page.evaluate("__calls.length = 0")
        self.page.click("[data-template]")
        self.assertTrue(self.page.locator("#skill-chip").is_visible())
        self.page.click("#lead-go")
        self.page.wait_for_selector("#approve-btn:enabled")
        self.assertEqual(self.page.evaluate("__calls.filter(call => call.kind === 'plan').length"), 0)
        self.assertEqual(self.page.evaluate("GlowLead.leads[0].skillName"), "Printer compare")
        self.assertEqual(self.page.locator("#edit-title-0").input_value(), "Draft the result")
        self.assertFalse(self.page.locator("#skill-chip").is_visible())

    def test_next_run_calculation(self):
        self.open()
        result = self.page.evaluate("""() => {
          const monday = new Date(2026, 9, 26, 9, 0).getTime();
          const friday = new Date(2026, 9, 30, 9, 0).getTime();
          const at = (a, from) => new Date(GlowLead.nextRunAfter(a, from)).toString();
          return {
            daily: at({cadence: 'daily', time: '08:00'}, monday) === new Date(2026, 9, 27, 8, 0).toString(),
            laterToday: at({cadence: 'daily', time: '10:00'}, monday) === new Date(2026, 9, 26, 10, 0).toString(),
            weekdays: at({cadence: 'weekdays', time: '08:00'}, friday) === new Date(2026, 10, 2, 8, 0).toString(),
            weekly: at({cadence: 'weekly', weekday: 3, time: '07:30'}, monday) === new Date(2026, 9, 28, 7, 30).toString(),
          };
        }""")
        self.assertEqual(result, {"daily": True, "laterToday": True, "weekdays": True, "weekly": True})

    def test_missed_automation_catches_up_once_and_asks_for_approval(self):
        self.context.add_init_script("""
          window.__notes = [];
          window.Notification = class {
            constructor(title, options) { window.__notes.push({ title, body: options.body }); }
            static get permission() { return 'granted'; }
            static requestPermission() { return Promise.resolve('granted'); }
          };""")
        automation = {"id": "auto1", "name": "Morning fares", "goal": "Check fares to Lisbon", "cadence": "daily",
                      "time": "08:00", "enabled": True, "approve": True, "nextRunAt": 1000}
        self.seed("glowlead.automations.v1", [automation])
        self.open()
        self.page.wait_for_function("GlowLead.leads.length === 1 && GlowLead.leads[0].status === 'awaiting'", timeout=10000)
        lead = self.page.evaluate("GlowLead.leads[0]")
        self.assertTrue(lead["catchUp"])
        self.assertEqual(lead["automationId"], "auto1")
        self.assertGreater(self.page.evaluate("GlowLead.readAutomations()[0].nextRunAt"), self.page.evaluate("Date.now()"))
        self.assertIsNone(self.page.evaluate("GlowLead.runDueAutomations()"))
        self.page.wait_for_timeout(300)
        self.assertEqual(self.page.evaluate("GlowLead.leads.length"), 1)
        self.assertIn("approval", self.page.evaluate("__notes[0].title"))
        self.assertIn("Catch-up", self.page.locator("#lead-run").text_content())

    def test_due_automation_runs_in_only_one_tab(self):
        automation = {"id": "auto2", "name": "Shared", "goal": "One run only", "cadence": "daily",
                      "time": "08:00", "enabled": True, "approve": True, "nextRunAt": 1000}
        self.seed("glowlead.automations.v1", [automation])
        self.context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=ENGINE_STUB))
        pages = [self.page, self.context.new_page()]
        for page in pages:
            page.goto(self.url + "/lead/")
        for page in pages:
            page.wait_for_function("!!window.GlowLead")
        self.page.wait_for_timeout(3000)
        stored = self.page.evaluate("JSON.parse(localStorage.getItem('glowlead.v1') || '[]').length")
        self.assertEqual(stored, 1)

    def test_create_pause_resume_and_delete_automation(self):
        self.open()
        self.page.fill("#lead-input", "Summarise new 3D printing news")
        self.page.click("#automate-btn")
        self.assertTrue(self.page.locator("#automation-approve").is_checked())
        self.assertFalse(self.page.locator("#automation-code").is_checked())
        self.page.select_option("#automation-cadence", "weekly")
        self.assertTrue(self.page.locator("#automation-weekday").is_visible())
        self.page.fill("#automation-time", "07:30")
        self.page.click("#automation-form button[type=submit]")
        saved = self.page.evaluate("GlowLead.readAutomations()")
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]["cadence"], "weekly")
        self.assertGreater(saved[0]["nextRunAt"], self.page.evaluate("Date.now()"))
        self.assertEqual(self.page.locator("#automation-count").inner_text(), "1")
        self.page.click("[data-toggle-automation]")
        self.assertFalse(self.page.evaluate("GlowLead.readAutomations()[0].enabled"))
        self.page.click("[data-toggle-automation]")
        self.assertTrue(self.page.evaluate("GlowLead.readAutomations()[0].enabled"))
        self.page.click("[data-delete-automation]")
        self.assertEqual(self.page.evaluate("GlowLead.readAutomations().length"), 0)

    def test_run_now_starts_with_saved_plan_and_permissions(self):
        self.open()
        self.start("Compare two printers")
        self.wait_done()
        self.page.click("#automate-mission")
        self.assertTrue(self.page.locator("#automation-plan-note").is_visible())
        self.page.click("#automation-form button[type=submit]")
        self.page.evaluate("__calls.length = 0")
        self.page.click("[data-run-automation]")
        self.page.wait_for_function("GlowLead.leads.length === 2 && GlowLead.leads[0].status === 'awaiting'")
        self.assertEqual(self.page.evaluate("__calls.filter(call => call.kind === 'plan').length"), 0)
        self.assertFalse(self.page.evaluate("GlowLead.leads[0].allowCode"))

    def test_invalid_stored_automations_and_memory_are_ignored(self):
        self.seed("glowlead.automations.v1", [{"id": 5}, {"id": "x", "goal": "g", "cadence": "hourly", "time": "08:00"}, "junk"])
        self.seed("glowlead.memory.v1", {"about": 42, "notes": [1, None, "valid note"]})
        self.open()
        self.assertEqual(self.page.evaluate("GlowLead.readAutomations().length"), 0)
        self.assertEqual(self.page.evaluate("GlowLead.memoryText()"), "- valid note")

    def test_mobile_run_view_with_follow_up_has_no_overflow(self):
        self.open()
        self.page.set_viewport_size({"width": 375, "height": 812})
        self.start("Draft a bakery plan")
        self.wait_done()
        self.assertTrue(self.page.locator("#followup-input").is_visible())
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
