# photo2cad

**PRD + 6 reference photos → a real CAD file (`.stp` STEP), plus an STL preview.**

Upload six photos of an object (front / back / left / right / top / bottom) and paste a
**PRD** (product requirements / spec). An LLM (Pegatron **MAAS**, OpenAI-compatible) turns the
spec into a **CadQuery** program; the server executes it in a sandbox and returns a validated
**STEP** file and a live 3D preview.

> Part of the [`apps/`](../) monorepo. Unlike the other apps, this one is **not** stdlib-only —
> producing genuine STEP requires a BREP kernel (`cadquery`/`OCP`).

## What it does

```
PRD text + 6 photos
        │
        ▼  (MAAS LLM, vision-assisted)
  CadQuery program  (parametric, mm)
        │
        ▼  (sandboxed subprocess, AST-guarded, timeout)
   model.stp  +  model.stl
        │
        ▼  (re-import + solid/bbox/volume checks)
  validated STEP  →  download  +  browser 3D preview
```

## Honest constraints (read this)

- **Output is `.stp` (STEP).** **Creo `.prt` is proprietary and is NOT produced** — Creo
  imports STEP natively, so `.stp` is the interchange deliverable.
- **Photos are visual reference / dimension assist, not exact geometry.** The PRD drives the
  parametric geometry. This is not a "read the exact shape off six photos" system.
- Generated CAD code is **untrusted**: it is AST-guarded (imports allow-listed, dangerous calls
  blocked) and run in a **child process with a hard timeout**. Treat it as untrusted.

## Layout

```
apps/photo2cad/
  web/        static front-end (6 slots + PRD + three.js preview + downloads)
  server/     stdlib HTTP server; MAAS client; cadgen; sandbox; validate; pipeline
  tests/      hermetic stdlib tests (run with the cadquery venv)
  docs/       interface contract (photo2cad-spec.md)
  Dockerfile  Python 3.12 + cadquery (deploy target)
```

## Run locally

The repo has a venv with cadquery at the monorepo root: `.venv3d`.

```powershell
# from the repo root
& ".\.venv3d\Scripts\python.exe" apps\photo2cad\server\server.py --port 8000
# then open http://127.0.0.1:8000
```

Set the LLM (otherwise generate returns a clear `stage: "llm"` error):

```powershell
$env:MAAS_API_KEY    = "<token>"
$env:MAAS_LLM_BASE_URL = "https://aicc-gateway.pegatroncorp.com/maas/api/v1/llm/v1"
$env:MAAS_LLM_MODEL    = "gpt-4o"
# offline UI smoke test (no network, canned program):
$env:PHOTO2CAD_FAKE_LLM = "1"
```

## Tests

```powershell
& ".\.venv3d\Scripts\python.exe" apps\photo2cad\tests\test_sandbox.py
& ".\.venv3d\Scripts\python.exe" apps\photo2cad\tests\verify_api.py
```

Both are hermetic (free port, `PHOTO2CAD_FAKE_LLM=1`, temporary/ignored artifact dir) and exit
`0`/`1`. They must be run with a Python that has cadquery (the `.venv3d` interpreter).

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | `{ok, llm_configured}` |
| `POST` | `/api/generate` | JSON `{prd, units, use_vision, model, images:{front,...,bottom}}` → `{ok, job_id, step_url, stl_url, report, program, logs}` |
| `GET` | `/api/artifacts/<job_id>/<file>` | `model.stp`, `model.stl`, `program.py`, `report.json` |

Images are data URLs (`FileReader.readAsDataURL`). Full contract: [`docs/photo2cad-spec.md`](docs/photo2cad-spec.md).

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `MAAS_API_KEY` | — | Bearer token (fallback `GATEWAY_API_KEY`) |
| `MAAS_LLM_BASE_URL` | `https://aicc-gateway.pegatroncorp.com/maas/api/v1/llm/v1` | LLM base URL |
| `MAAS_LLM_MODEL` | `gpt-4o` | Model id |
| `PHOTO2CAD_FAKE_LLM` | `0` | `1` → canned program, no network |
| `PHOTO2CAD_SANDBOX_TIMEOUT` | `120` | child process timeout (s) |
| `PHOTO2CAD_ARTIFACTS` | `apps/photo2cad/.artifacts` | artifact root |

## Deploy (Kubernetes via aicc-deploy-agent)

Single component, `Dockerfile` at this app root, container port **8000**.

- **Use memory ≥ 1Gi** — the OCCT kernel is memory-heavy; the `256Mi` default is too small.
- Pass the LLM settings as `env_vars` at deploy time (`MAAS_API_KEY`, `MAAS_LLM_BASE_URL`, `MAAS_LLM_MODEL`).
- Confirm the cluster can reach the MAAS gateway (it is an internal host).

## License

See the repository [`LICENSE`](../../LICENSE).
