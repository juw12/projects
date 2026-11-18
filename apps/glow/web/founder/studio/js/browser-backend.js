// Browser backend for GlowFounder (the studio on a Glow page).
//
// The local Founder Studio app talks to server.py. On a web page there is no server, so this module
// answers the same /api/... calls inside the browser: it loads Python (Pyodide, bundled in
// ./pyodide/) and runs the real server.py Studio class and the skill's own scripts
// (panel.py, van_westendorp.py, unit_economics.py, compile.py). Every number is computed by
// the same code as the local app.
//
// Two things differ from the local app:
//   - Projects are kept in this browser (IndexedDB), so they are still there after a reload.
//   - AI buyers are answered by Glow's free models (no key), called from this page.
//
// It only activates when the page is not served by server.py (any host other than localhost).

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
// On a Glow page there is no Founder Studio server, so <html data-backend="browser"> forces this mode.
const isDemo = !LOCAL_HOSTS.has(location.hostname)
  || new URLSearchParams(location.search).has("browser")
  || document.documentElement.dataset.backend === "browser";

// The folder inside the in-browser file system that holds the projects. It is also the name of the
// browser database that keeps them.
const PROJECTS_DIR = "/glow-founder";

const PY_SETUP = `
import contextlib, io, json, runpy, sys, traceback
from pathlib import Path

sys.path.insert(0, "/app")
import server

def run_tool_in_process(self, script, *args, stdin=None):
    """Same contract as Studio.run_tool, but runs the script in this interpreter (no subprocess in a browser)."""
    if not self.tools:
        raise RuntimeError("skill tools not found")
    argv = [str(self.tools / script), *[str(a) for a in args]]
    out, err = io.StringIO(), io.StringIO()
    saved_argv, saved_stdin = sys.argv, sys.stdin
    sys.argv = argv
    if stdin is not None:
        sys.stdin = io.StringIO(stdin)
    code = 0
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            runpy.run_path(argv[0], run_name="__main__")
    except SystemExit as stop:
        if isinstance(stop.code, int):
            code = stop.code
        elif stop.code is not None:
            err.write(str(stop.code))
            code = 1
    except Exception:
        err.write(traceback.format_exc())
        code = 1
    finally:
        sys.argv, sys.stdin = saved_argv, saved_stdin
    return code, out.getvalue(), err.getvalue()

server.Studio.run_tool = run_tool_in_process
STUDIO = server.Studio("${PROJECTS_DIR}", "/app/tools")

def handle(method, path, query_json, body_json):
    query = json.loads(query_json)
    try:
        if method == "GET" and path == "/api/projects":
            data = STUDIO.list_projects()
            data["root"] = "this browser"
        elif method == "GET" and path == "/api/project":
            data = STUDIO.get_project(query.get("name", ""), query.get("variant"))
        elif method == "GET" and path == "/api/system-prompt":
            role = query.get("role") or "buyer"
            if role not in server.SYSTEM_PROMPTS:
                raise ValueError(f"unknown role {role!r}")
            data = {"system": server.SYSTEM_PROMPTS[role]}
        elif method == "POST":
            routes = {
                "/api/deal": STUDIO.deal,
                "/api/answers": STUDIO.save_answers,
                "/api/numbers": STUDIO.numbers,
                "/api/save": STUDIO.save_file,
                "/api/verdict": STUDIO.verdict,
            }
            if path not in routes:
                return 404, json.dumps({"error": "not found"})
            data = routes[path](json.loads(body_json or "{}"))
        else:
            return 404, json.dumps({"error": "not found"})
        return 200, json.dumps(data, ensure_ascii=False)
    except (ValueError, KeyError) as error:
        return 400, json.dumps({"error": str(error)})
    except FileNotFoundError as error:
        return 404, json.dumps({"error": str(error)})
    except Exception as error:
        return 500, json.dumps({"error": str(error)})
`;

let enginePromise = null;

function setStatus(text) {
  let node = document.getElementById("demo-engine-status");
  if (!node) {
    node = document.createElement("div");
    node.id = "demo-engine-status";
    node.setAttribute("role", "status");
    node.className = "demo-engine-status";
    document.body.append(node);
  }
  node.textContent = text;
  node.hidden = !text;
}

// Copies the projects folder from the browser database (load = true) or to it (load = false).
function syncProjects(pyodide, load) {
  return new Promise((resolve, reject) => {
    pyodide.FS.syncfs(load, (error) => (error ? reject(error) : resolve()));
  });
}

async function startEngine() {
  setStatus("Loading the Python engine (one time, about 14 MB)...");
  const base = new URL("../pyodide/", import.meta.url).href;
  const { loadPyodide } = await import(new URL("pyodide.mjs", base).href);
  const pyodide = await loadPyodide({ indexURL: base });
  pyodide.FS.mkdirTree(PROJECTS_DIR);
  let keeps = true;
  try {
    pyodide.FS.mount(pyodide.FS.filesystems.IDBFS, {}, PROJECTS_DIR);
    await syncProjects(pyodide, true);
  } catch (error) {
    // No browser database (some private windows): the studio still works, and projects last until the tab closes.
    keeps = false;
  }
  const bundle = await (await realFetch(new URL("../bundle.json", import.meta.url).href)).json();
  for (const [path, content] of Object.entries(bundle.files)) {
    const isProject = path.startsWith("projects/");
    const full = isProject ? `${PROJECTS_DIR}/${path.slice("projects/".length)}` : `/app/${path}`;
    // The example project is only written when it is not there yet, so edits to it are kept.
    if (isProject && pyodide.FS.analyzePath(full).exists) continue;
    pyodide.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
    pyodide.FS.writeFile(full, content, { encoding: "utf8" });
  }
  await pyodide.runPythonAsync(PY_SETUP);
  setStatus("");
  return { handle: pyodide.globals.get("handle"), pyodide, keeps };
}

const realFetch = window.fetch.bind(window);

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

// ---- AI buyers, reviewers and the editor: Glow's free models, no key ----
// The provider list and the failover live in Glow's own kit (../../shared/glow-harness-kit.js), so this
// page always uses the same free services as the rest of Glow. A reply that is not the JSON the brief
// asked for counts as no answer, and the next service is asked.
const prompts = {};
let lastGood = null; // the service that answered last is asked first

async function freeModelAnswer(engine, body) {
  const kit = window.GlowHarnessKit;
  if (!kit) throw new Error("Glow's free AI did not load. Reload the page and try again.");
  const role = body.role || "buyer";
  if (!prompts[role]) {
    const reply = engine.handle("GET", "/api/system-prompt", JSON.stringify({ role }), "");
    const [status, text] = reply.toJs();
    reply.destroy();
    const data = JSON.parse(text);
    if (status !== 200) throw new Error(data.error || "unknown role");
    prompts[role] = data.system;
  }
  const messages = [{ role: "system", content: prompts[role] }, { role: "user", content: String(body.brief || "") }];
  const order = lastGood ? [lastGood, ...kit.PROVIDERS.filter((provider) => provider !== lastGood)] : kit.PROVIDERS;
  const failures = [];
  for (const provider of order) {
    try {
      const reply = await kit.chatBrain({ providers: [provider], temperature: 0.9, timeoutMs: 60000, fetch: realFetch }).next({ messages });
      const match = reply.text.match(/\{[\s\S]*\}/);
      if (!match) {
        failures.push(`${provider.label}: the reply was not JSON`);
        continue;
      }
      const answer = JSON.parse(match[0]);
      lastGood = provider;
      return { answer, raw: reply.text, via: provider.label };
    } catch (error) {
      failures.push(error instanceof SyntaxError ? `${provider.label}: the reply was not JSON` : String(error.message || error).replace(/^No free model answered \(|\)$/g, ""));
    }
  }
  throw new Error(`No free AI model answered (${failures.join("; ")}). Try again in a moment, or use Quick sim.`);
}

let saving = Promise.resolve();

async function demoFetch(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  const marker = url.pathname.indexOf("/api/");
  if (marker < 0) return realFetch(input, init);
  const path = url.pathname.slice(marker);
  enginePromise = enginePromise || startEngine();
  let engine;
  try {
    engine = await enginePromise;
  } catch (error) {
    enginePromise = null;
    setStatus("");
    return jsonResponse(500, { error: `Could not start the in-browser engine: ${error.message}` });
  }
  const method = (init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  if (method === "POST" && path === "/api/llm") {
    try {
      return jsonResponse(200, await freeModelAnswer(engine, JSON.parse(body || "{}")));
    } catch (error) {
      return jsonResponse(502, { error: error.message });
    }
  }
  const query = JSON.stringify(Object.fromEntries(url.searchParams));
  const result = engine.handle(method, path, query, body);
  const [status, text] = result.toJs();
  result.destroy();
  if (method === "POST" && engine.keeps) {
    // Every change is copied to the browser database, one copy at a time.
    saving = saving.then(() => syncProjects(engine.pyodide, false)).catch(() => {});
    await saving;
  }
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

if (isDemo) {
  window.fetch = demoFetch;
  document.documentElement.classList.add("online-demo");
}

export { isDemo };
