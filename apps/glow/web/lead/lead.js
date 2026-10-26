// GlowLead: the lead of the Glow apps. Like a "boss bot" orchestrator it does not do the work itself:
// it PLANS a goal (steps + done-criteria), DELEGATES each step to GlowChat (one model), a GlowChat
// Council (Builder, Critic, Judge) or the GlowRoom crew (web research, code), CHECKS the results
// against the done-criteria (one fix-up round if something is missing) and REPORTS back.
// The whole lead becomes one chat in GlowChat (via the shared "glow.inbox"), and every crew
// mission it starts is saved in GlowRoom's own results, so GlowLead is the owner of GlowRoom.
(function () {
  "use strict";

  const TEST_MODE = location.hash === "#selftest";
  const LEADS_KEY = TEST_MODE ? "glowlead.selftest" : "glowlead.v1";
  const INBOX_KEY = TEST_MODE ? "glow.inbox.selftest" : "glow.inbox";
  const THEME_KEY = "glow.home.theme";
  const MAX_LEADS = 20;
  const MAX_STEPS = 4;
  const CONTEXT_PER_STEP = 2500;
  const POLL_MS = TEST_MODE ? 15 : 1000;

  const WORKERS = {
    chat: { icon: "💬", name: "GlowChat", hint: "one strong model writes, explains or plans" },
    council: { icon: "⚖", name: "GlowChat Council", hint: "Builder and Critic debate, a Judge decides" },
    room: { icon: "🏢", name: "GlowRoom crew", hint: "reads the live web, runs code, cites sources" },
  };
  const STATUS_TEXT = {
    planning: "Planning the work…",
    awaiting: "Plan ready: approve it to start",
    working: "The team is working…",
    checking: "Checking the work against the done-criteria…",
    done: "Done",
    stopped: "Stopped",
    error: "Couldn't finish",
  };

  // Everything GlowLead does with AI goes through this backend, so the self-test can swap it out.
  const backend = {
    chat: (options) => window.CrewEngine.tools.chat(options),
    startRoom: (task, meta) => window.CrewEngine.start(task, { meta }),
    getRun: (id) => window.CrewEngine.getRun(id),
    stopRoom: (id) => window.CrewEngine.stop(id),
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clip = (s, n) => {
    const text = String(s || "").trim();
    return text.length > n ? text.slice(0, n - 1).trimEnd() + "…" : text;
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const md = (text) => (window.CrewEngine && window.CrewEngine.renderMarkdown ? window.CrewEngine.renderMarkdown(text) : "<p>" + esc(text) + "</p>");

  let leads = loadLeads();
  let shownId = null;
  const controllers = {};

  // ------------------------------------------------------------------ storage
  function loadLeads() {
    try {
      const list = JSON.parse(localStorage.getItem(LEADS_KEY) || "[]");
      if (!Array.isArray(list)) return [];
      list.forEach((lead) => {
        if (["planning", "working", "checking"].includes(lead.status)) lead.status = "stopped"; // interrupted by a reload
      });
      return list;
    } catch (error) {
      return [];
    }
  }
  function saveLeads() {
    try {
      localStorage.setItem(LEADS_KEY, JSON.stringify(leads.slice(0, MAX_LEADS)));
    } catch (error) {
      leads = leads.slice(0, 5);
    }
  }

  // ------------------------------------------------------------------ planning
  const PLAN_SYSTEM = [
    "You are GlowLead, the lead of a team of AI apps. You never do the work yourself: you plan it, delegate it and check it.",
    "Your workers:",
    '- "chat" = GlowChat: one strong AI model. Best for explaining, writing, brainstorming, drafting and planning.',
    '- "council" = GlowChat Council: a Builder and a Critic debate, then a Judge decides. Best for decisions, trade-offs and risk reviews.',
    '- "room" = GlowRoom crew: a researcher that reads the live web, a coder that runs JavaScript and a reviewer. Use it ONLY when a step needs current facts, prices, sources, calculations or code.',
    "Rules: use 1 to 4 steps (fewer is better; a simple goal needs 1 step). Each task must be a complete instruction the worker can do alone.",
    "Also write 2 to 4 done-criteria: short, concrete, checkable statements the final result must satisfy.",
    'Reply with JSON only, no other text: {"summary":"one sentence","criteria":["..."],"steps":[{"worker":"chat|council|room","title":"short title","task":"full instruction"}]}',
  ].join("\n");

  const RESEARCH_HINT = /\b(latest|current|today|price|prices|cost|costs|compare|research|sources?|news|statistics|data|calculate|code|script|search|202\d)\b/i;

  function extractJson(text) {
    const cleaned = String(text || "").replace(/```(?:json)?/gi, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (error) {
      return null;
    }
  }

  function fallbackPlan(goal) {
    if (RESEARCH_HINT.test(goal)) {
      return [
        { worker: "room", title: "Research it with the crew", task: goal },
        { worker: "chat", title: "Turn the findings into a clear answer", task: "Using the crew's findings, write the final answer to: " + goal },
      ];
    }
    return [{ worker: "chat", title: "Do it", task: goal }];
  }

  function parsePlan(text, goal) {
    const json = extractJson(text);
    let steps = Array.isArray(json && json.steps) ? json.steps : [];
    steps = steps
      .filter((s) => s && (s.task || s.title))
      .map((s) => ({
        worker: WORKERS[s.worker] ? s.worker : "chat",
        title: clip(s.title || s.task, 80),
        task: clip(s.task || s.title, 1500),
      }))
      .slice(0, MAX_STEPS);
    let criteria = Array.isArray(json && json.criteria) ? json.criteria.map((c) => clip(c, 200)).filter(Boolean).slice(0, 5) : [];
    const planned = steps.length > 0;
    if (!planned) steps = fallbackPlan(goal);
    if (!criteria.length) criteria = ["Directly answers: " + clip(goal, 140), "Concrete and usable, not generic"];
    return { summary: clip((json && json.summary) || "", 300), criteria, steps, planned };
  }

  // ------------------------------------------------------------------ checking
  const REVIEW_SYSTEM = [
    "You are GlowLead, the team lead. Your team has finished the steps below.",
    "1) Write the final deliverable for the user in Markdown. Lead with the answer. Keep the team's facts, numbers and source links; remove repetition; do not describe the process.",
    '2) On the very last line write CHECK: followed by JSON {"met":[true or false for each done-criterion, in order],"missing":"what is still missing, or empty"}.',
  ].join("\n");

  function parseReview(text, criteriaCount) {
    const raw = String(text || "");
    const marker = raw.lastIndexOf("CHECK:");
    const report = (marker >= 0 ? raw.slice(0, marker) : raw).trim();
    const json = marker >= 0 ? extractJson(raw.slice(marker)) : null;
    const met = [];
    for (let i = 0; i < criteriaCount; i++) {
      met.push(json && Array.isArray(json.met) ? json.met[i] !== false : null);
    }
    return { report, met, missing: clip(json && json.missing, 500), checked: !!json };
  }

  // ------------------------------------------------------------------ workers
  function contextFrom(lead, uptoIndex) {
    const done = lead.steps.slice(0, uptoIndex).filter((s) => s.output);
    if (!done.length) return "";
    return "\n\nWork already done by the team:\n" + done
      .map((s) => `### ${WORKERS[s.worker].name}: ${s.title}\n${clip(s.output, CONTEXT_PER_STEP)}`)
      .join("\n\n");
  }

  async function ask(system, content, signal, maxTokens = 2200) {
    const text = await backend.chat({ system, messages: [{ role: "user", content }], signal, maxTokens, temperature: 0.4 });
    if (signal && signal.aborted) throw new DOMException("Stopped", "AbortError");
    return String(text || "").trim();
  }

  async function runChatStep(lead, step, index, signal) {
    step.progress = "GlowChat is writing…";
    render(lead);
    return ask(
      "You are GlowChat, working for GlowLead (the team lead). Do the task completely and concretely. Use Markdown. No preamble.",
      `Overall goal: ${lead.goal}\n\nYour task: ${step.task}${contextFrom(lead, index)}`,
      signal,
    );
  }

  async function runCouncilStep(lead, step, index, signal) {
    const brief = `Overall goal: ${lead.goal}\n\nTask: ${step.task}${contextFrom(lead, index)}`;
    step.progress = "⚖ Builder is proposing…";
    render(lead);
    const builder = await ask("You are the Builder in a GlowChat Council. Propose the best concrete answer to the task. Be specific.", brief, signal, 1500);
    step.progress = "⚖ Critic is reviewing…";
    render(lead);
    const critic = await ask(
      "You are the Critic in a GlowChat Council. Name the biggest weaknesses, risks or missing points in the Builder's answer (short bullets), then say how to fix them.",
      `${brief}\n\nBuilder's answer:\n${clip(builder, 4000)}`, signal, 900,
    );
    step.progress = "⚖ Judge is deciding…";
    render(lead);
    const judge = await ask(
      "You are the Judge of a GlowChat Council. Write the final answer: lead with the decision, combine the Builder's proposal with the Critic's valid points, and end with a one-line confidence level.",
      `${brief}\n\nBuilder:\n${clip(builder, 4000)}\n\nCritic:\n${clip(critic, 2500)}`, signal, 1800,
    );
    step.debate = { builder, critic };
    return judge;
  }

  async function runRoomStep(lead, step, index, signal) {
    const mission = `${step.task}\n\nOverall goal (from GlowLead): ${lead.goal}${clip(contextFrom(lead, index), 1500)}`;
    const run = backend.startRoom(mission, { from: "glowlead", leadId: lead.id });
    step.roomRunId = run.id;
    step.progress = "🏢 The crew got the mission…";
    render(lead);
    const onAbort = () => backend.stopRoom(run.id);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        await sleep(POLL_MS);
        if (signal && signal.aborted) throw new DOMException("Stopped", "AbortError");
        const current = backend.getRun(run.id) || run;
        const crewSteps = current.steps || [];
        const doneCount = crewSteps.filter((s) => s.status === "done").length;
        const working = crewSteps.find((s) => s.status === "running");
        step.progress = current.planning ? "🏢 Nova is planning the crew's work…"
          : current.writingFinal ? "🏢 Nova is writing the crew's result…"
          : crewSteps.length ? `🏢 Crew step ${Math.min(doneCount + 1, crewSteps.length)} of ${crewSteps.length}${working && window.CrewEngine && window.CrewEngine.BOTS[working.bot] ? " · " + window.CrewEngine.BOTS[working.bot].name + " is working" : ""}`
          : "🏢 The crew is working…";
        render(lead);
        if (current.status === "running") continue;
        if (current.status === "done" && current.final) return current.final;
        throw new Error(current.error || "The GlowRoom crew couldn't finish this step.");
      }
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  const RUNNERS = { chat: runChatStep, council: runCouncilStep, room: runRoomStep };

  async function runStep(lead, index, signal) {
    const step = lead.steps[index];
    step.status = "running";
    step.startedAt = Date.now();
    step.error = "";
    render(lead);
    try {
      step.output = await RUNNERS[step.worker](lead, step, index, signal);
      step.status = "done";
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      step.status = "error";
      step.error = clip(error && error.message, 300) || "Something went wrong.";
    }
    step.progress = "";
    step.finishedAt = Date.now();
    saveLeads();
    handToGlowChat(lead);
    render(lead);
  }

  // ------------------------------------------------------------------ the lead loop
  async function plan(lead) {
    const controller = new AbortController();
    controllers[lead.id] = controller;
    lead.status = "planning";
    render(lead);
    try {
      const text = await ask(PLAN_SYSTEM, `Goal: ${lead.goal}`, controller.signal, 900);
      const parsed = parsePlan(text, lead.goal);
      lead.summary = parsed.summary;
      lead.criteria = parsed.criteria;
      lead.steps = parsed.steps.map((s) => ({ ...s, status: "queued", output: "" }));
    } catch (error) {
      if (error && error.name === "AbortError") return finish(lead, "stopped");
      // Planning failed (e.g. the free AI is busy): fall back to a simple plan instead of giving up.
      lead.criteria = ["Directly answers: " + clip(lead.goal, 140), "Concrete and usable, not generic"];
      lead.steps = fallbackPlan(lead.goal).map((s) => ({ ...s, status: "queued", output: "" }));
      lead.note = "Planned with a simple default because the planner was busy.";
    } finally {
      delete controllers[lead.id];
    }
    if (lead.approve) {
      lead.status = "awaiting";
      saveLeads();
      render(lead);
      return null;
    }
    return work(lead);
  }

  async function work(lead) {
    const controller = new AbortController();
    controllers[lead.id] = controller;
    const signal = controller.signal;
    lead.status = "working";
    saveLeads();
    handToGlowChat(lead);
    render(lead);
    try {
      for (let i = 0; i < lead.steps.length; i++) {
        if (lead.steps[i].status === "done") continue;
        await runStep(lead, i, signal);
      }
      if (!lead.steps.some((s) => s.status === "done")) throw new Error(lead.steps.map((s) => s.error).filter(Boolean)[0] || "No step could be finished.");

      lead.status = "checking";
      render(lead);
      let review = await reviewWork(lead, signal);
      if (review.met.some((m) => m === false) && !lead.fixed) {
        // One fix-up round: hand what is missing back to GlowChat, then check again.
        lead.fixed = true;
        lead.steps.push({
          worker: "chat",
          title: "Fix what the check found missing",
          task: `The check found this still missing: ${review.missing || "some done-criteria are not met"}. Improve the team's work so every done-criterion is met: ${lead.criteria.join("; ")}`,
          status: "queued",
          output: "",
          fixup: true,
        });
        lead.status = "working";
        await runStep(lead, lead.steps.length - 1, signal);
        lead.status = "checking";
        render(lead);
        review = await reviewWork(lead, signal);
      }
      lead.report = review.report || lead.steps.filter((s) => s.output).map((s) => s.output).pop() || "";
      lead.met = review.met;
      lead.checked = review.checked;
      lead.missing = review.missing;
      return finish(lead, "done");
    } catch (error) {
      if (error && error.name === "AbortError") return finish(lead, "stopped");
      lead.error = clip(error && error.message, 400) || "Something went wrong.";
      return finish(lead, "error");
    } finally {
      delete controllers[lead.id];
    }
  }

  async function reviewWork(lead, signal) {
    const work = lead.steps
      .filter((s) => s.output)
      .map((s) => `### ${WORKERS[s.worker].name}: ${s.title}\n${clip(s.output, 6000)}`)
      .join("\n\n");
    const criteria = lead.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
    const text = await ask(REVIEW_SYSTEM, `Goal: ${lead.goal}\n\nDone-criteria:\n${criteria}\n\nTeam's work:\n${work}`, signal, 3000);
    return parseReview(text, lead.criteria.length);
  }

  function finish(lead, status) {
    lead.status = status;
    lead.finishedAt = Date.now();
    lead.steps.forEach((s) => {
      if (s.status === "running" || s.status === "queued") s.status = status === "done" ? s.status : "stopped";
      s.progress = "";
    });
    saveLeads();
    handToGlowChat(lead);
    render(lead);
    renderHistory();
    if (status === "done" && !TEST_MODE) toast("👑 GlowLead finished: the report is below and in GlowChat.");
    return lead;
  }

  function startLead(goal, approve) {
    const text = String(goal || "").trim();
    if (!text) return null;
    const lead = { id: uid(), goal: text.slice(0, 2000), approve: !!approve, status: "planning", createdAt: Date.now(), criteria: [], steps: [], report: "" };
    leads.unshift(lead);
    leads = leads.slice(0, MAX_LEADS);
    saveLeads();
    shownId = lead.id;
    renderHistory();
    const done = plan(lead);
    return { lead, done };
  }

  function stopLead(lead) {
    if (controllers[lead.id]) controllers[lead.id].abort();
    else if (lead.status === "awaiting") finish(lead, "stopped");
  }

  // ------------------------------------------------------------------ GlowChat hand-off
  // The whole lead is one chat in GlowChat (updated as it goes), tagged 👑, so you can keep asking there.
  function leadTranscript(lead) {
    const messages = [{ role: "user", content: lead.goal }];
    const planLines = lead.steps.map((s, i) => `${i + 1}. ${WORKERS[s.worker].icon} **${WORKERS[s.worker].name}**: ${s.title}`).join("\n");
    if (lead.steps.length) {
      messages.push({ role: "assistant", content: `👑 **GlowLead's plan**\n\n${planLines}\n\n**Done when:**\n${lead.criteria.map((c) => "- " + c).join("\n")}` });
    }
    lead.steps.forEach((s) => {
      if (s.output) messages.push({ role: "assistant", content: `${WORKERS[s.worker].icon} **${WORKERS[s.worker].name}: ${s.title}**\n\n${s.output}` });
    });
    if (lead.report) {
      const checks = lead.criteria.map((c, i) => `${lead.met && lead.met[i] === false ? "✗" : lead.met && lead.met[i] === true ? "✓" : "•"} ${c}`).join("\n");
      messages.push({ role: "assistant", content: `${lead.report}\n\n---\n👑 **Checked by GlowLead**\n${checks}` });
    }
    return messages;
  }

  function handToGlowChat(lead) {
    let inbox = [];
    try {
      inbox = JSON.parse(localStorage.getItem(INBOX_KEY) || "[]");
    } catch (error) {
      inbox = [];
    }
    if (!Array.isArray(inbox)) inbox = [];
    const item = {
      id: "lead-" + lead.id,
      type: "chat",
      title: "👑 " + clip(lead.goal.split("\n")[0], 70),
      messages: leadTranscript(lead),
      source: "glowlead",
      updated: Date.now(),
    };
    inbox = inbox.filter((c) => c && c.id !== item.id).concat(item).slice(-10);
    try {
      localStorage.setItem(INBOX_KEY, JSON.stringify(inbox));
    } catch (error) {
      // Storage full: GlowChat will simply not get this update.
    }
  }

  // ------------------------------------------------------------------ rendering
  function stepHtml(lead, step, index) {
    const worker = WORKERS[step.worker];
    const badge = { queued: "Waiting", running: "Working", done: "Done", error: "Problem", stopped: "Stopped" }[step.status] || step.status;
    const seconds = step.finishedAt && step.startedAt ? ` · ${Math.max(1, Math.round((step.finishedAt - step.startedAt) / 1000))} s` : "";
    const links = [];
    if (step.roomRunId) links.push('<a href="../room/" target="_blank" rel="noopener">Open the mission in GlowRoom ↗</a>');
    if (step.output && step.worker !== "room") links.push(`<a href="../chat/?open=lead-${esc(lead.id)}" target="_blank" rel="noopener">Continue in GlowChat ↗</a>`);
    return `<li class="step ${esc(step.status)}">
      <div class="step-top">
        <span class="step-ic" aria-hidden="true">${worker.icon}</span>
        <span class="step-title"><b>${index + 1}. ${esc(step.title)}</b><small>${esc(worker.name)}${step.fixup ? " · fix-up round" : ""}${seconds}</small></span>
        <span class="badge ${esc(step.status)}">${esc(badge)}</span>
      </div>
      ${step.progress ? `<div class="step-progress">${esc(step.progress)}</div>` : ""}
      ${step.error ? `<div class="step-progress error-text">${esc(step.error)}</div>` : ""}
      ${step.output ? `<details><summary>See ${esc(worker.name)}'s work</summary><div class="md">${md(step.output)}</div></details>` : ""}
      ${links.length ? `<div class="step-links">${links.join("")}</div>` : ""}
    </li>`;
  }

  function render(lead) {
    if (!lead || lead.id !== shownId) return;
    const box = $("lead-run");
    if (!box) return;
    box.hidden = false;
    const busy = ["planning", "working", "checking"].includes(lead.status);
    const doneCount = lead.steps.filter((s) => s.status === "done").length;
    const statusLine = lead.status === "working" && lead.steps.length
      ? `${STATUS_TEXT.working} ${doneCount} of ${lead.steps.length} steps done`
      : STATUS_TEXT[lead.status] || lead.status;
    const criteria = lead.criteria.map((c, i) => {
      const state = lead.met && lead.met[i] === true ? "met" : lead.met && lead.met[i] === false ? "unmet" : "";
      const mark = state === "met" ? "✓" : state === "unmet" ? "✗" : "○";
      return `<li class="${state}"><span class="mark">${mark}</span><span>${esc(c)}</span></li>`;
    }).join("");
    let html = `<div class="run-head">
        <div><h2>👑 ${esc(clip(lead.goal.split("\n")[0], 140))}</h2><div class="status" id="lead-status"><b>${esc(statusLine)}</b>${lead.summary ? " · " + esc(lead.summary) : ""}</div></div>
        <div class="run-actions">
          ${lead.status === "awaiting" ? '<button class="btn gold" type="button" id="approve-btn">✓ Approve plan &amp; run</button>' : ""}
          ${busy || lead.status === "awaiting" ? '<button class="btn small" type="button" id="stop-btn">■ Stop</button>' : ""}
          ${!busy && lead.status !== "awaiting" && lead.status !== "done" ? '<button class="btn small" type="button" id="retry-btn">↻ Try again</button>' : ""}
        </div>
      </div>`;
    if (lead.note) html += `<p class="note">${esc(lead.note)}</p>`;
    if (lead.criteria.length) html += `<div class="block"><h3>Done when</h3><ul class="criteria" id="criteria">${criteria}</ul></div>`;
    if (lead.steps.length) html += `<div class="block"><h3>Plan · who does what</h3><ol class="steps" id="steps">${lead.steps.map((s, i) => stepHtml(lead, s, i)).join("")}</ol></div>`;
    if (lead.error) html += `<p class="error-text">${esc(lead.error)} You can press ↻ Try again; on Glow Free each step may wait about 30 seconds for the shared limit.</p>`;
    if (lead.report) {
      const allMet = lead.met && lead.met.length && lead.met.every((m) => m === true);
      const verdict = !lead.checked ? "Result (not fully checked)"
        : allMet ? "✓ Checked: every done-criterion is met"
        : `⚠ Checked: some criteria are still not met${lead.missing ? " — " + lead.missing : ""}`;
      html += `<div class="block"><h3>${esc(verdict)}</h3><div class="report"><div class="md" id="report">${md(lead.report)}</div>
        <div class="report-actions">
          <a class="btn primary small" href="../chat/?open=lead-${esc(lead.id)}" target="_blank" rel="noopener">💬 Continue in GlowChat</a>
          <button class="btn small" type="button" id="copy-btn">Copy</button>
          <button class="btn small" type="button" id="download-btn">Download .md</button>
        </div></div></div>`;
    }
    box.innerHTML = html;
    const on = (id, fn) => {
      const el = $(id);
      if (el) el.addEventListener("click", fn);
    };
    on("approve-btn", () => {
      lead.approve = false;
      work(lead);
    });
    on("stop-btn", () => stopLead(lead));
    on("retry-btn", () => {
      lead.error = "";
      lead.steps.forEach((s) => {
        if (s.status !== "done") s.status = "queued";
      });
      if (lead.steps.length) work(lead);
      else plan(lead);
    });
    on("copy-btn", () => {
      navigator.clipboard && navigator.clipboard.writeText(lead.report).then(() => toast("Copied"), () => toast("Couldn't copy"));
    });
    on("download-btn", () => {
      const blob = new Blob([`# ${lead.goal}\n\n${lead.report}\n`], { type: "text/markdown" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "glowlead-" + clip(lead.goal, 40).replace(/[^\w]+/g, "-").toLowerCase() + ".md";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    });
  }

  function renderHistory() {
    const list = $("history");
    const box = $("history-box");
    if (!list || !box) return;
    const icon = { done: "✓", error: "⚠", stopped: "■", awaiting: "⏸" };
    box.hidden = !leads.length;
    list.innerHTML = leads.map((lead) => `<li><button type="button" data-lead="${esc(lead.id)}"><span>${icon[lead.status] || "…"} ${esc(clip(lead.goal.split("\n")[0], 90))}</span><span>${esc(timeAgo(lead.createdAt))}</span></button></li>`).join("");
  }

  function timeAgo(ts) {
    const seconds = Math.max(1, Math.round((Date.now() - Number(ts || 0)) / 1000));
    if (seconds < 60) return "just now";
    if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
    if (seconds < 86400) return Math.round(seconds / 3600) + " h ago";
    return Math.round(seconds / 86400) + " d ago";
  }

  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function renderAccount() {
    const chip = $("account-chip");
    const button = $("signin-btn");
    if (!chip || !window.CrewEngine || TEST_MODE) return;
    const status = window.CrewEngine.glow.status();
    chip.textContent = status.signedIn ? `✦ ${status.name || "Glow user"} · ${status.model}` : "👤 Guest · Glow Free";
    if (button) button.hidden = status.signedIn || status.checking;
  }

  function applyTheme() {
    let theme = localStorage.getItem(THEME_KEY);
    if (!theme) {
      try {
        theme = (JSON.parse(localStorage.getItem("mufakat.v1") || "{}").settings || {}).theme;
      } catch (error) {
        theme = "";
      }
    }
    if (theme !== "light" && theme !== "dark") theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    const button = $("theme-btn");
    if (button) button.textContent = theme === "light" ? "☾" : "☀";
  }

  // ------------------------------------------------------------------ wiring
  function wire() {
    $("lead-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const goal = $("lead-input").value;
      if (!goal.trim()) {
        $("lead-input").focus();
        return;
      }
      startLead(goal, $("lead-approve").checked);
      $("lead-input").value = "";
      $("lead-run").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("lead-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) $("lead-form").requestSubmit();
    });
    $("examples").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-goal]");
      if (!chip) return;
      $("lead-input").value = chip.dataset.goal;
      $("lead-input").focus();
    });
    $("history").addEventListener("click", (event) => {
      const button = event.target.closest("[data-lead]");
      const lead = button && leads.find((l) => l.id === button.dataset.lead);
      if (!lead) return;
      shownId = lead.id;
      render(lead);
      $("lead-run").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("theme-btn").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      localStorage.setItem(THEME_KEY, next);
      applyTheme();
    });
    $("signin-btn").addEventListener("click", () => {
      window.CrewEngine.glow.signIn().then(renderAccount, () => toast("Sign-in didn't finish. You can keep using Glow Free."));
    });
    if (window.CrewEngine) {
      window.CrewEngine.on("settings", renderAccount);
      window.CrewEngine.on("notice", (message) => toast("✦ " + message));
    }
  }

  function boot() {
    applyTheme();
    wire();
    renderAccount();
    renderHistory();
    if (leads[0] && !TEST_MODE) {
      shownId = leads[0].id;
      render(leads[0]);
    }
    // A goal handed over from Glow home (?goal=…&go=1 starts it straight away).
    const params = new URLSearchParams(location.search);
    const goal = (params.get("goal") || "").trim();
    if (goal && !TEST_MODE) {
      history.replaceState(null, "", location.pathname + location.hash);
      if (params.get("go") === "1") startLead(goal, false);
      else $("lead-input").value = goal.slice(0, 2000);
    }
    if ("serviceWorker" in navigator && location.protocol === "https:" && !TEST_MODE) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
    if (TEST_MODE) selfTest();
  }

  // ------------------------------------------------------------------ self-test (#selftest)
  async function selfTest() {
    const results = [];
    const expect = (name, ok) => results.push(`${ok ? "PASS" : "FAIL"} ${name}`);
    localStorage.removeItem(LEADS_KEY);
    localStorage.removeItem(INBOX_KEY);
    leads = [];
    const calls = [];
    let reviews = 0;
    const rooms = {};
    backend.chat = async ({ system, messages }) => {
      calls.push(system.slice(0, 40));
      await sleep(2);
      if (system === PLAN_SYSTEM) {
        return '```json\n{"summary":"Name, cost and launch a bakery","criteria":["Has 5 names","Has a budget in rupiah"],"steps":[' +
          '{"worker":"chat","title":"Name ideas","task":"Give 5 bakery names"},' +
          '{"worker":"council","title":"Pick the best name","task":"Decide the best name"},' +
          '{"worker":"room","title":"Research costs","task":"Find current oven prices in Batam"},' +
          '{"worker":"robot","title":"Unknown worker","task":"Should fall back to chat"},' +
          '{"worker":"chat","title":"Too many","task":"Fifth step is cut"}]}\n```';
      }
      if (system === REVIEW_SYSTEM) {
        reviews += 1;
        return reviews === 1
          ? '## Bakery plan\nNames and costs.\nCHECK: {"met":[true,false],"missing":"budget in rupiah"}'
          : '## Bakery plan\nNames, and a budget of Rp 50 juta.\nCHECK: {"met":[true,true],"missing":""}';
      }
      return "Output for: " + messages[0].content.split("\n").find((line) => line.startsWith("Your task") || line.startsWith("Task") || line.startsWith("Overall")) ;
    };
    backend.startRoom = (task, meta) => {
      const run = { id: "room-" + uid(), goal: task, status: "running", steps: [{ bot: "explore", status: "running" }], meta, polls: 0 };
      rooms[run.id] = run;
      return run;
    };
    backend.getRun = (id) => {
      const run = rooms[id];
      run.polls += 1;
      if (run.polls >= 3) Object.assign(run, { status: "done", final: "Ovens cost about Rp 15 juta [1]." });
      return run;
    };
    backend.stopRoom = (id) => {
      if (rooms[id]) rooms[id].status = "stopped";
    };

    // Parsing
    const parsed = parsePlan("not json at all", "What are the latest prices of iPhones?");
    expect("plan: unreadable plans fall back to a research + answer plan", !parsed.planned && parsed.steps[0].worker === "room" && parsed.steps.length === 2 && parsed.criteria.length === 2);
    expect("plan: simple goals fall back to one GlowChat step", parsePlan("", "Write a poem about rain").steps.length === 1 && parsePlan("", "Write a poem about rain").steps[0].worker === "chat");
    const review = parseReview('Final\nCHECK: {"met":[true,false],"missing":"x"}', 2);
    expect("check: CHECK line is read and removed from the report", review.report === "Final" && review.met[0] === true && review.met[1] === false && review.missing === "x");
    expect("check: a missing CHECK line counts as not checked", parseReview("Just text", 2).checked === false && parseReview("Just text", 2).met[0] === null);

    // Full lead
    const { lead, done } = startLead("Open a small bakery in Batam", false);
    await done;
    expect("lead: plan keeps max 4 steps and maps unknown workers to GlowChat", lead.steps.filter((s) => !s.fixup).length === 4 && lead.steps[3].worker === "chat");
    expect("lead: steps went to GlowChat, Council and the GlowRoom crew", lead.steps[0].worker === "chat" && lead.steps[1].worker === "council" && lead.steps[2].worker === "room");
    expect("lead: the Council ran Builder, Critic and Judge", calls.filter((c) => /Builder|Critic|Judge/.test(c)).length === 3 && !!lead.steps[1].debate);
    expect("lead: the GlowRoom mission is tagged as GlowLead's and its result used", lead.steps[2].output.includes("Rp 15 juta") && rooms[lead.steps[2].roomRunId].meta.from === "glowlead");
    expect("lead: a failed check triggers one fix-up round, then passes", lead.fixed === true && lead.steps.some((s) => s.fixup && s.status === "done") && reviews === 2 && lead.met.every((m) => m === true));
    expect("lead: finished with a checked report", lead.status === "done" && lead.checked && lead.report.includes("Rp 50 juta") && !lead.report.includes("CHECK"));
    const inbox = JSON.parse(localStorage.getItem(INBOX_KEY) || "[]");
    const handed = inbox.find((c) => c.id === "lead-" + lead.id);
    expect("glowchat: the lead became one 👑 chat in GlowChat with plan, work and report", !!handed && handed.source === "glowlead" && handed.title.startsWith("👑") && handed.messages[0].role === "user" && handed.messages.length >= 6 && handed.messages[handed.messages.length - 1].content.includes("Checked by GlowLead"));
    expect("ui: report, criteria and steps are shown", !!document.querySelector("#report") && document.querySelectorAll("#criteria li.met").length === 2 && document.querySelectorAll("#steps .step").length === 5);
    expect("history: the lead is saved and listed", JSON.parse(localStorage.getItem(LEADS_KEY))[0].id === lead.id && document.querySelectorAll("#history [data-lead]").length === 1);

    // Approval first
    calls.length = 0;
    const approval = startLead("Write a poem about rain", true);
    await approval.done;
    expect("approve: with 'show me the plan first' GlowLead waits before working", approval.lead.status === "awaiting" && calls.length === 1 && !!document.querySelector("#approve-btn"));
    document.querySelector("#approve-btn").click();
    for (let i = 0; i < 200 && approval.lead.status !== "done"; i++) await sleep(10);
    expect("approve: approving runs the plan to the end", approval.lead.status === "done");

    // Stop
    backend.chat = (options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")));
    });
    const stopping = startLead("Something slow", false);
    await sleep(20);
    stopLead(stopping.lead);
    await stopping.done;
    expect("stop: ■ Stop ends the lead without an error", stopping.lead.status === "stopped" && !stopping.lead.error);

    // Escaping
    const xss = { id: "x", goal: "<img src=x onerror=alert(1)>", status: "done", criteria: ["<b>c</b>"], steps: [], report: "<script>alert(1)</script>", met: [true], checked: true };
    shownId = "x";
    render(xss);
    expect("safety: goals, criteria and reports are escaped", !document.querySelector("#lead-run img") && !document.querySelector("#lead-run script") && !document.querySelector("#criteria b"));

    localStorage.removeItem(LEADS_KEY);
    localStorage.removeItem(INBOX_KEY);
    const out = document.createElement("pre");
    out.id = "selftest-results";
    out.textContent = results.join("\n");
    document.body.appendChild(out);
    document.body.dataset.selftest = results.every((r) => r.startsWith("PASS")) ? "pass" : "fail";
  }

  window.GlowLead = { start: startLead, stop: stopLead, get leads() { return leads; }, parsePlan, parseReview, WORKERS };
  boot();
})();
