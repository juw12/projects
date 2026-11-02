# photo2cad — Interface Contract & Spec

## Purpose
Turn a product **PRD** (text spec) + **6 reference photos** (front/back/left/right/top/bottom)
into a real CAD file — **`.stp` (STEP, ISO-10303-21)** — plus an **`.stl`** preview and a
validation report. An LLM (Pegatron **MAAS**, OpenAI-compatible) synthesizes a **CadQuery**
program; the server executes it in a **sandboxed subprocess** and validates the result.

## Non-goals / hard constraints (do not pretend otherwise)
- **STEP (`.stp`) only.** Creo **`.prt` is proprietary and unsupported.** Creo imports STEP.
- **Photos are visual reference / dimension assist — NOT exact geometry.** The PRD drives the
  parametric geometry. Never claim geometry is "read" precisely off the photos.
- This app is the **exception to the repo's stdlib-only rule**: it requires
  `cadquery` (+ `OCP`) and `requests`. `server.py` itself stays stdlib-only; the CAD/LLM
  work happens in child processes / optional imports.

## Layout
```
apps/me-rd-toolkit/photo2cad/
  web/                static front-end (served by server.py)
    index.html
    styles.css
    js/app.js
    js/viewer.js
  server/
    server.py         stdlib http.server; routes + static; owns /api
    config.py         env/config resolution
    maas.py           Pegatron MAAS OpenAI-compatible client
    cadgen.py         PRD+photos -> CadQuery source (LLM) + code extraction
    sandbox.py        AST-guard + subprocess execution -> STEP/STL
    validate.py       re-import STEP, solid/bbox/volume checks
    pipeline.py       orchestrates maas -> cadgen -> sandbox -> validate
  tests/
    verify_api.py     hermetic stdlib e2e (FAKE_LLM)
    test_sandbox.py   executes a known-good program -> STEP
  docs/               this file
  Dockerfile
  requirements.txt
  README.md
```

## HTTP API (JSON only; no multipart)
### `GET /` and static
Serves `web/`.

### `POST /api/generate`
Request body:
```json
{
  "prd": "string (required)",
  "units": "mm",
  "use_vision": true,
  "model": "optional model id override",
  "images": {
    "front":  "data:image/png;base64,...",
    "back":   "...", "left": "...", "right": "...", "top": "...", "bottom": "..."
  }
}
```
`images` values are data URLs (browser `FileReader.readAsDataURL`). Missing views allowed.

Success response:
```json
{
  "ok": true,
  "job_id": "8-hex",
  "step_url": "/api/artifacts/<job_id>/model.stp",
  "stl_url":  "/api/artifacts/<job_id>/model.stl",
  "report": { "valid": true, "solids": 1, "bbox_mm": [20.0,10.0,5.0],
              "volume_mm3": 950.0, "warnings": [] },
  "program": "<the cadquery python source>",
  "logs": "<tail of child stdout/stderr>"
}
```
Failure response (HTTP 200 with ok=false, or 4xx/5xx for bad request):
```json
{ "ok": false, "error": "message", "stage": "llm|cadgen|exec|validate",
  "program": "<source if available>", "logs": "<tail>" }
```

### `GET /api/artifacts/<job_id>/<filename>`
Serves a generated file (`model.stp`, `model.stl`, `program.py`, `report.json`). Path-traversal safe.

### `GET /api/health`
`{ "ok": true, "llm_configured": true|false }`

## Module contracts (importable, stdlib-only signatures)
### `server/config.py`
```
@dataclass class Config:
    api_key: str; base_url: str; model: str; use_vision: bool
    fake_llm: bool; sandbox_timeout: int; max_images: int
def load_config() -> Config   # env-driven; also PEER roots for artifacts
```

### `server/maas.py`
```
def available(cfg) -> bool
def chat(cfg, messages: list[dict], model: str|None=None,
         temperature: float=0, timeout: int=120) -> str
    # POST {base_url}/chat/completions, Authorization: Bearer {api_key}
    # returns choices[0].message.content; raises RuntimeError on non-2xx
```
If `cfg.fake_llm` → `chat` returns a canned CadQuery program (see CADGEN_CONTRACT) so tests run offline.

### `server/cadgen.py`
```
def build_program(cfg, prd: str, images: dict, use_vision: bool=True,
                  model: str|None=None) -> str
    # builds system+user messages (vision: image_url data URLs when use_vision),
    # calls maas.chat, extracts the FIRST fenced ```python block (or raw if none),
    # returns CadQuery source
```
**CADGEN_CONTRACT** (the prompt MUST enforce it): the returned program
- imports only `cadquery as cq` and `math`;
- builds a solid and assigns it to a module-level variable named **`SHAPE`**
  (a `cq.Workplane`);
- defines **no** other I/O, no `open`, no network, no `print`-dependencies;
- is fully parametric with named numeric parameters in mm.
Canned (fake) program used by FAKE_LLM:
```python
import cadquery as cq
L, W, H = 40.0, 30.0, 20.0
SHAPE = cq.Workplane("XY").box(L, W, H).edges("|Z").fillet(3.0)
```

### `server/sandbox.py`
```
def guard(source: str) -> tuple[bool, str]     # AST allow/deny check
def run_program(source: str, outdir: str, timeout: int=120) -> dict
    # writes program.py, runs a harness child via sys.executable:
    #   imports cadquery, execs source, exports SHAPE -> model.stp + model.stl
    # returns {ok, step_path, stl_path, stdout, stderr, error, seconds}
```
Guard rules (reject on violation): allow only `import cadquery`/`import cadquery as cq`/`import math`;
**deny** `Import`/`ImportFrom` of anything else; deny calls to
`open, eval, exec, compile, __import__, input, globals, locals, exit, quit, breakpoint`;
deny attribute names matching `__*__` (dunder access). Enforce a hard subprocess timeout.

### `server/validate.py`
```
def validate_step(step_path: str) -> dict
    # re-import via cq.importers.importStep; count solids; bbox; volume
    # returns {valid, solids, bbox_mm:[x,y,z], volume_mm3, warnings:[...]}
```
`valid` = exactly 1 solid and non-empty bbox. Missing volume → warning, not failure.

### `server/pipeline.py`
```
def generate(cfg, prd: str, images: dict, workdir_root: str,
             use_vision: bool=True, model: str|None=None) -> dict
    # maas/cadgen -> sandbox -> validate; creates <workdir_root>/<job_id>/
    # returns the success/failure dict from the API contract (incl. job_id, urls)
```

### `server/server.py`
- `ThreadingHTTPServer`, stdlib only. Serves `web/` for `GET /` and static assets.
- Implements the API above. Artifacts under `config.load_config()`-derived root
  (default `apps/me-rd-toolkit/photo2cad/.artifacts/`, git-ignored).
- `--port` (default 8000), `--lan` (bind 0.0.0.0). Path-traversal-safe artifact serving.
- Bounded request size (e.g. 25 MB) for JSON bodies.

## Env vars
| Var | Default | Purpose |
|---|---|---|
| `MAAS_API_KEY` | "" | Bearer token (fallback `GATEWAY_API_KEY`) |
| `MAAS_LLM_BASE_URL` | `https://aicc-gateway.pegatroncorp.com/maas/api/v1/llm/v1` | LLM base (append `/chat/completions`) |
| `MAAS_LLM_MODEL` | `gpt-4o` | Model id (override per request via `model`) |
| `PHOTO2CAD_FAKE_LLM` | `0` | `1` → canned program, no network |
| `PHOTO2CAD_SANDBOX_TIMEOUT` | `120` | child timeout seconds |
| `PHOTO2CAD_ARTIFACTS` | `<app>/.artifacts` | artifact root |

## Dev/test
- Tests are stdlib-only and hermetic: start the server on a free port with
  `PHOTO2CAD_FAKE_LLM=1`, POST a minimal request, assert STEP + valid report.
- Local (real LLM) run uses the repo venv: `.venv3d\Scripts\python.exe server\server.py`
  (it has cadquery + requests). Document this in the README.

## Deployment (aicc-deploy-agent)
- Single component, `Dockerfile` at app root, container port **8000**.
- **Memory: request 1Gi** (OCCT kernel is heavy — the 256Mi default is too small).
- Pass `MAAS_API_KEY` / `MAAS_LLM_BASE_URL` / `MAAS_LLM_MODEL` as `env_vars` at deploy time.
