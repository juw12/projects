#!/usr/bin/env python3
"""Stackup tests — hermetic, standard library only. Exit 0 on success, 1 on failure.

1. Static integrity: required files exist, are UTF-8, offline (no remote fetches).
2. Service-worker shell list points at files that exist.
3. Reference math (pure Python) reproduces golden results for the three presets.
4. If a JavaScript runtime is available (macOS `osascript -l JavaScript` or `node`),
   the real stackup-core.js is executed and compared with the same golden results.
5. The free workbook is a valid .xlsx with live formulas and contains no Pro sheets.
"""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import zipfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(BASE, "web")

REQUIRED = [
    "index.html", "app.html", "web.html", "mobile.html", "app.css", "app.js",
    "stackup-core.js", "manifest.webmanifest", "sw.js", "screenshot.png",
    "icons/app-icon.svg", "icons/icon-192.png", "icons/icon-512.png",
    "icons/apple-touch-icon.png", "downloads/Stackup-Lite.xlsx",
]

PRESETS = {
    "preset-gasket": {
        "lsl": 0.35, "usl": 0.65,
        "rows": [(1.6, 0.08, 0.08, 1, "normal", 3), (1.2, 0.05, 0.05, -1, "normal", 3),
                 (0.3, 0.05, 0.05, 1, "normal", 3), (0.2, 0.05, 0.05, -1, "normal", 3),
                 (0.0, 0.05, 0.05, -1, "uniform", 3)],
    },
    "preset-pcb": {
        "lsl": 0.2, "usl": None,
        "rows": [(60, 0.1, 0.1, 0.5, "normal", 3), (58.8, 0.1, 0.1, -0.5, "normal", 3),
                 (0, 0.05, 0.05, -1, "normal", 3), (0, 0.05, 0.05, -1, "normal", 3),
                 (0, 0.1, 0.1, -1, "uniform", 3)],
    },
    "preset-snap": {
        "lsl": 0.3, "usl": 0.75,
        "rows": [(0.8, 0.05, 0.05, 1, "normal", 3), (0.3, 0.06, 0.06, -1, "normal", 3),
                 (0, 0.05, 0.05, -1, "normal", 3), (0, 0.05, 0.05, -1, "normal", 3)],
    },
}

# Golden values (checked independently against SciPy and a spreadsheet formula engine).
GOLDEN = {
    "preset-gasket": {"mean": 0.5, "wcMin": 0.22, "wcMax": 0.78, "sigma": 0.0487624628, "cpk": 1.0253788905, "ppm": 2097.017, "verdict": "fail"},
    "preset-pcb": {"mean": 0.6, "wcMin": 0.3, "wcMax": 0.9, "sigma": 0.0666666667, "cpk": 2.0, "ppm": 0.000987, "verdict": "pass-wc"},
    "preset-snap": {"mean": 0.5, "wcMin": 0.29, "wcMax": 0.71, "sigma": 0.0351188458, "cpk": 1.8983159915, "ppm": 0.006171, "verdict": "pass-stat"},
}

failures = []


def check(condition, message):
    print(("ok - " if condition else "FAIL - ") + message)
    if not condition:
        failures.append(message)


def close(a, b, rel=1e-6, abs_tol=1e-9):
    return math.isclose(a, b, rel_tol=rel, abs_tol=abs_tol)


def reference(preset):
    mean = 0.0
    half_sum = 0.0
    var = 0.0
    for nominal, tp, tm, sens, dist, k in preset["rows"]:
        m = nominal + (tp - tm) / 2
        h = (tp + tm) / 2
        s = h / math.sqrt(3) if dist == "uniform" else h / math.sqrt(6) if dist == "triangular" else h / k
        mean += sens * m
        half_sum += abs(sens) * h
        var += (sens * s) ** 2
    sigma = math.sqrt(var)
    lsl, usl = preset["lsl"], preset["usl"]
    sides = [x for x in ((mean - lsl) if lsl is not None else None, (usl - mean) if usl is not None else None) if x is not None]
    cpk = min(sides) / (3 * sigma)
    phi = lambda z: 0.5 * math.erfc(-z / math.sqrt(2))  # noqa: E731
    out = (phi((lsl - mean) / sigma) if lsl is not None else 0) + (1 - phi((usl - mean) / sigma) if usl is not None else 0)
    wc_min, wc_max = mean - half_sum, mean + half_sum
    wc_pass = (lsl is None or wc_min >= lsl - 1e-12) and (usl is None or wc_max <= usl + 1e-12)
    verdict = "pass-wc" if wc_pass else "pass-stat" if cpk >= 1.33 else "fail"
    return {"mean": mean, "wcMin": wc_min, "wcMax": wc_max, "sigma": sigma, "cpk": cpk, "ppm": out * 1e6, "verdict": verdict}


def compare(label, got):
    for pid, want in GOLDEN.items():
        g = got[pid]
        for key in ("mean", "wcMin", "wcMax", "sigma", "cpk"):
            check(close(g[key], want[key]), f"{label} {pid} {key} = {g[key]:.10g}")
        check(close(g["ppm"], want["ppm"], rel=1e-3, abs_tol=1e-6), f"{label} {pid} ppm = {g['ppm']:.6g}")
        check(g["verdict"] == want["verdict"], f"{label} {pid} verdict = {g['verdict']}")


def run_js():
    core = open(os.path.join(WEB, "stackup-core.js"), encoding="utf-8").read()
    script = core + """
var out = {};
StackupCore.PRESETS.forEach(function (p) {
  var a = StackupCore.analyze(p);
  var mc = StackupCore.monteCarlo(p, {samples: 20000});
  out[p.id] = {mean: a.mean, wcMin: a.wcMin, wcMax: a.wcMax, sigma: a.sigma, cpk: a.cpk, ppm: a.ppm,
               verdict: a.verdict, mcMean: mc.mean, mcStd: mc.std, csv: StackupCore.toCsv(p).length};
});
JSON.stringify(out);
"""
    if sys.platform == "darwin" and shutil.which("osascript"):
        cmd = ["osascript", "-l", "JavaScript", "-e", script]
    elif shutil.which("node"):
        cmd = ["node", "-e", script.replace("JSON.stringify(out);", "console.log(JSON.stringify(out));")]
    else:
        return None
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        check(False, "JS core executed: " + result.stderr.strip()[:300])
        return None
    return json.loads(result.stdout.strip())


def main():
    for name in REQUIRED:
        path = os.path.join(WEB, name)
        check(os.path.isfile(path) and os.path.getsize(path) > 0, f"{name} exists")

    texts = {}
    for name in ("index.html", "app.html", "web.html", "mobile.html", "app.css", "app.js", "stackup-core.js", "sw.js"):
        try:
            with open(os.path.join(WEB, name), encoding="utf-8") as handle:
                texts[name] = handle.read()
        except (OSError, UnicodeDecodeError) as err:
            check(False, f"{name} readable as UTF-8 ({err})")
    for name in ("app.js", "stackup-core.js", "sw.js"):
        js = texts.get(name, "")
        check(not re.search(r"fetch\(\s*['\"]https?://|XMLHttpRequest|importScripts\(\s*['\"]https?://", js), f"{name} makes no remote requests")
    for name in ("app.html", "web.html", "mobile.html"):
        html = texts.get(name, "")
        check('src="stackup-core.js"' in html and 'src="app.js"' in html, f"{name} loads core + app")
        check(not re.search(r'(src|href)="/', html), f"{name} has no absolute-root paths")

    manifest = json.load(open(os.path.join(WEB, "manifest.webmanifest"), encoding="utf-8"))
    check(manifest.get("start_url") == "./app.html", "manifest start_url is relative")
    for icon in manifest.get("icons", []):
        check(os.path.isfile(os.path.join(WEB, icon["src"])), f"manifest icon {icon['src']} exists")

    shell = re.search(r"var SHELL = \[(.*?)\];", texts.get("sw.js", ""), re.S)
    entries = re.findall(r'"([^"]+)"', shell.group(1)) if shell else []
    check(len(entries) > 5, "service worker shell list parsed")
    for entry in entries:
        if entry != "./":
            check(os.path.isfile(os.path.join(WEB, entry)), f"sw shell entry {entry} exists")

    compare("python-ref", {pid: reference(p) for pid, p in PRESETS.items()})

    js = run_js()
    if js is None:
        print("skip - no JavaScript runtime available; JS core not executed")
    else:
        compare("js-core", js)
        for pid, row in js.items():
            check(abs(row["mcStd"] - GOLDEN[pid]["sigma"]) / GOLDEN[pid]["sigma"] < 0.03, f"js-core {pid} Monte Carlo std within 3% of RSS sigma")
            check(row["csv"] > 200, f"js-core {pid} CSV export non-empty")

    xlsx = os.path.join(WEB, "downloads", "Stackup-Lite.xlsx")
    try:
        with zipfile.ZipFile(xlsx) as book:
            names = book.namelist()
            workbook_xml = book.read("xl/workbook.xml").decode("utf-8")
            sheets = re.findall(r'<sheet [^>]*name="([^"]+)"', workbook_xml)
            check(sheets == ["Start", "Stack"], f"Lite workbook sheets = {sheets}")
            sheet_files = [n for n in names if n.startswith("xl/worksheets/sheet")]
            formulas = "".join(book.read(n).decode("utf-8") for n in sheet_files)
            check("NORMSDIST" in formulas and "SUMPRODUCT" in formulas, "Lite workbook has live formulas")
            for paid in ("Monte Carlo", "DVT Tracker", "RCA Log", "Dashboard", "Gasket"):
                check(paid not in sheets, f"Pro sheet '{paid}' not shipped in the free workbook")
    except (OSError, zipfile.BadZipFile, KeyError) as err:
        check(False, f"Lite workbook is a valid xlsx ({err})")

    print("\n" + "=" * 50)
    if failures:
        print(f"SUMMARY: {len(failures)} FAILED")
        return 1
    print("SUMMARY: ALL TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
