#!/usr/bin/env python3
"""Mint core tests — hermetic, standard library only. Exit 0 on success, 1 on failure.

1. Static integrity: required files exist, are UTF-8, and use relative paths only
   (the site is served from a sub-path on GitHub Pages).
2. Service-worker shell entries and manifest icons point at files that exist.
3. Seed marketplace data is well formed.
4. If a JavaScript runtime is available (`node`, or macOS `osascript -l JavaScript`),
   the real core.js / xlsx.js are executed: prompt generation (EN + ID), tweak
   commands, the safe formula engine, promo kit, and the .xlsx writer. The
   resulting workbook is unzipped here and checked for well-formed XML and live formulas.
"""

import base64
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from xml.dom import minidom

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(BASE, "web")

REQUIRED = [
    "index.html", "app.html", "web.html", "mobile.html", "app.css",
    "js/core.js", "js/xlsx.js", "js/store.js", "js/guides.js", "js/i18n.js", "js/app.js",
    "manifest.webmanifest", "sw.js", "screenshot.png", "data/seed.json",
    "icons/app-icon.svg", "icons/icon-192.png", "icons/icon-512.png",
    "icons/apple-touch-icon.png",
]

failures = []


def check(condition, message):
    if condition:
        print("  ok   " + message)
    else:
        print("  FAIL " + message)
        failures.append(message)


def read(rel):
    with open(os.path.join(WEB, rel), encoding="utf-8") as handle:
        return handle.read()


def static_checks():
    print("static integrity")
    for rel in REQUIRED:
        check(os.path.isfile(os.path.join(WEB, rel)), "exists: " + rel)
    for rel in ["index.html", "app.html", "web.html", "mobile.html"]:
        html = read(rel)
        root_paths = re.findall(r'(?:src|href)="(/[^"/][^"]*)"', html)
        check(not root_paths, rel + " uses relative asset paths " + str(root_paths[:3]))
        remote = re.findall(r'<script[^>]+src="https?://', html)
        check(not remote, rel + " loads no remote scripts")
        for asset in re.findall(r'(?:src|href)="([^"#:?]+\.(?:js|css|webmanifest|png|svg))"', html):
            check(os.path.isfile(os.path.join(WEB, asset)), rel + " -> " + asset)
    check('class="is-mobile"' in read("mobile.html") or "is-mobile" in read("mobile.html"),
          "mobile.html enables mobile layout")

    sw = read("sw.js")
    shell = re.search(r"SHELL\s*=\s*\[(.*?)\]", sw, re.S)
    check(shell is not None, "sw.js declares SHELL list")
    if shell:
        for entry in re.findall(r'"([^"]+)"', shell.group(1)):
            if entry == "./":
                continue
            check(os.path.isfile(os.path.join(WEB, entry)), "sw shell entry exists: " + entry)
    check("/api/" in sw or "api/" in sw, "sw.js bypasses the API")

    manifest = json.loads(read("manifest.webmanifest"))
    check(manifest.get("start_url", "").startswith("./"), "manifest start_url is relative")
    check(os.path.isfile(os.path.join(WEB, manifest.get("start_url", ""), "index.html")),
          "the installed app opens on Mint Budget (" + manifest.get("start_url", "") + ")")
    check(manifest.get("id") == "projects/mint/app.html", "install identity stays the one Mint PWAs already have")
    front = read("index.html")
    check("'budget/'" in front and "out.set('view', 'market')" in front,
          "index.html forwards to Budget, template links to the Marketplace tab")
    for rel in ["app.html", "web.html", "mobile.html"]:
        check(read(rel).count('href="budget/"') >= 2, rel + " links to Budget in the nav and the tab bar")
    check("/^mint-v\\d/.test(k)" in sw, "sw.js only clears its own mint-v caches (Budget keeps mint-budget-v)")
    for icon in manifest.get("icons", []):
        check(os.path.isfile(os.path.join(WEB, icon["src"])), "manifest icon exists: " + icon["src"])


def cloud_checks():
    print("cloud worker")
    cloud = os.path.join(BASE, "cloud")
    for rel in ["src/index.js", "wrangler.toml", "wrangler.local.toml", "package.json", "test/api_test.mjs"]:
        check(os.path.isfile(os.path.join(cloud, rel)), "exists: cloud/" + rel)
    toml = open(os.path.join(cloud, "wrangler.toml"), encoding="utf-8").read()
    check('new_sqlite_classes = ["MintDB"]' in toml, "Durable Object uses the SQLite backend (free plan)")
    check("https://juw12.github.io" in toml, "CORS allows the live site origin")
    worker = open(os.path.join(cloud, "src/index.js"), encoding="utf-8").read()
    for needle in ["PBKDF2", "Authorization", "requireLimit", "createOrder", "commission-paid", "aiSystemPrompt"]:
        check(needle in worker, "worker implements " + needle)
    store = read("js/store.js")
    check("mint-api.juw12.workers.dev" in store and "Bearer" in store, "app talks to the live API with a bearer token")
    html = read("app.html")
    check('name="mint-api"' in html, "API base is configurable via <meta name=mint-api>")


def seed_checks():
    print("seed data")
    seed = json.loads(read("data/seed.json"))
    listings = seed.get("listings", seed if isinstance(seed, list) else [])
    check(len(listings) >= 10, "seed has >= 10 listings (%d)" % len(listings))
    ids = [item.get("id") for item in listings]
    check(len(ids) == len(set(ids)), "seed listing ids are unique")
    for item in listings:
        spec = item.get("spec") or {}
        columns = (spec.get("sheet") or {}).get("columns") or []
        if not columns:
            check(False, "listing has columns: " + str(item.get("id")))
            break
    else:
        check(True, "every seed listing has columns")
    check(all(item.get("price", 0) == 0 for item in listings), "showcase seed templates are free")


JS_PROBE = r"""
var C = MintCore;
var X = MintXlsx;
var out = {};

var inv = C.generate("inventory tracker for my toko in rupiah, ocean theme").spec;
out.inv = {blueprint: inv.blueprint, currency: inv.currency, theme: inv.theme,
           columns: inv.sheet.columns.map(function (c) { return c.name; })};

var budgetId = C.generate("anggaran bulanan keluarga").spec;
out.budgetId = {blueprint: budgetId.blueprint, currency: budgetId.currency};

var custom = C.generate("track my bonsai trees with species, age and last watered");
out.custom = {columns: custom.spec.sheet.columns.map(function (c) { return c.name; }),
              title: custom.spec.title};

var budget = C.generate("monthly budget in USD").spec;
var computed = C.compute(budget);
out.budget = {rows: budget.sheet.rows.length, summary: computed.summary,
              errors: Object.keys(computed.errors).length};

var t1 = C.applyTweak(budget, "add 5 rows");
var t2 = C.applyTweak(budget, "tambah kolom Catatan");
var t3 = C.applyTweak(budget, "theme midnight");
var t4 = C.applyTweak(budget, "add column Diff = [Planned] - [Actual]");
var t5 = C.applyTweak(budget, "remove column Item");
var t6 = C.applyTweak(budget, "currency EUR");
var t7 = C.applyTweak(budget, "flibber the wobble");
out.tweaks = {
  rows: t1.spec.sheet.rows.length,
  addedId: t2.spec.sheet.columns.map(function (c) { return c.name; }),
  theme: t3.spec.theme,
  formulaCol: t4.spec.sheet.columns.slice(-1)[0],
  removed: t5.spec.sheet.columns.map(function (c) { return c.name; }),
  currency: t6.spec.currency,
  unknownChanged: t7.changed
};
var diffRows = C.compute(t4.spec).rows.map(function (r) {
  return r.cells.slice(-1)[0].value;
});
out.diffRows = diffRows;
out.plannedActual = budget.sheet.rows.map(function (r) {
  return [r[budget.sheet.columns[2].id], r[budget.sheet.columns[3].id]];
});

var zh = C.generate("monthly budget in USD").spec;
var zh0 = zh.sheet.rows.length, zhSum0 = zh.summary.length, zhRule0 = zh.rules.length;
var zt1 = C.applyTweak(zh, "新增 5 行");
var zt2 = C.applyTweak(zh, "新增 供应商 列");
var zt3 = C.applyTweak(zh, "新增一列 备注");
var zt4 = C.applyTweak(zt2.spec, "删除 供应商 列");
var zt5 = C.applyTweak(zh, "把 Planned 改成 Budget");
var zt6 = C.applyTweak(zh, "货币 EUR");
var zt7 = C.applyTweak(zh, "主题 深色");
var zt8 = C.applyTweak(zh, "合计 Planned");
var zt9 = C.applyTweak(zh, "高亮 Planned 低于 0 红色");
var ztF = C.applyTweak(zh, "新增 差额 列 公式 [Planned]-[Actual]");
out.zh = {
  rowsAdded: zt1.spec.sheet.rows.length - zh0,
  hasGys: zt2.spec.sheet.columns.some(function (c) { return c.name === "供应商"; }),
  hasNote: zt3.spec.sheet.columns.some(function (c) { return c.name === "备注"; }),
  gysRemoved: !zt4.spec.sheet.columns.some(function (c) { return c.name === "供应商"; }),
  renamed: zt5.spec.sheet.columns.map(function (c) { return c.name; }),
  currency: zt6.spec.currency,
  theme: zt7.spec.theme,
  sumAdded: zt8.spec.summary.length - zhSum0,
  lastSum: zt8.spec.summary[zt8.spec.summary.length - 1],
  ruleAdded: zt9.spec.rules.length - zhRule0,
  lastRule: zt9.spec.rules[zt9.spec.rules.length - 1],
  formula: ztF.spec.sheet.columns.slice(-1)[0]
};
var es = C.generate("monthly budget in USD").spec;
var es0 = es.sheet.rows.length, esSum0 = es.summary.length, esRule0 = es.rules.length;
var et1 = C.applyTweak(es, "agregar 5 filas");
var et2 = C.applyTweak(es, "agregar columna Prioridad");
var et3 = C.applyTweak(es, "renombrar Planned a Presupuesto");
var et4 = C.applyTweak(es, "eliminar Item");
var et5 = C.applyTweak(es, "moneda EUR");
var et6 = C.applyTweak(es, "tema oscuro");
var et7 = C.applyTweak(es, "suma de Planned");
var et8 = C.applyTweak(es, "resalta Planned menos que 0 rojo");
var etT = C.applyTweak(es, "agregar columna Margen como número");
out.es = {
  rowsAdded: et1.spec.sheet.rows.length - es0,
  hasPrio: et2.spec.sheet.columns.some(function (c) { return c.name === "Prioridad"; }),
  renamed: et3.spec.sheet.columns.map(function (c) { return c.name; }),
  itemRemoved: !et4.spec.sheet.columns.some(function (c) { return c.name === "Item"; }),
  currency: et5.spec.currency,
  theme: et6.spec.theme,
  sumAdded: et7.spec.summary.length - esSum0,
  lastSum: et7.spec.summary[et7.spec.summary.length - 1],
  ruleAdded: et8.spec.rules.length - esRule0,
  lastRule: et8.spec.rules[et8.spec.rules.length - 1],
  typedCol: etT.spec.sheet.columns.slice(-1)[0]
};

var trad = C.generate("monthly budget in USD").spec;
var t0 = trad.sheet.rows.length, tSum0 = trad.summary.length, tRule0 = trad.rules.length;
var tt1 = C.applyTweak(trad, "刪除 Item");
var tt2 = C.applyTweak(trad, "合計 Planned");
var tt3 = C.applyTweak(trad, "貨幣 EUR");
var tt4 = C.applyTweak(trad, "主題 深色");
var tt5 = C.applyTweak(trad, "高亮 Planned 低於 0 紅色");
var tt6 = C.applyTweak(trad, "把 Planned 改為 Budget");
var tt7 = C.applyTweak(trad, "新增 供應商 欄");
out.trad = {
  removedItem: !tt1.spec.sheet.columns.some(function (c) { return c.name === "Item"; }),
  sumAdded: tt2.spec.summary.length - tSum0,
  lastSum: tt2.spec.summary[tt2.spec.summary.length - 1],
  currency: tt3.spec.currency,
  theme: tt4.spec.theme,
  ruleAdded: tt5.spec.rules.length - tRule0,
  lastRule: tt5.spec.rules[tt5.spec.rules.length - 1],
  renamed: tt6.spec.sheet.columns.map(function (c) { return c.name; }),
  hasSup: tt7.spec.sheet.columns.some(function (c) { return c.name === "供應商"; })
};

function ev(src, vars) {
  return C.evaluate(C.parse(src), function (n) { return vars[n]; });
}
out.formulas = {
  arith: ev("1 + 2 * 3 - 4 / 2", {}),
  power: ev("2 ^ 10", {}),
  ifs: ev('IF([Qty] < [Min], "Reorder", "OK")', {Qty: 5, Min: 10}),
  logic: ev("AND([a] > 1, OR([b] = 0, NOT([c])))", {a: 2, b: 0, c: false}),
  round: ev("ROUND(2.71828, 2)", {}),
  minmax: ev("MAX(3, 9, 4) - MIN(3, 9, 4)", {}),
  abs: ev("ABS(-7)", {}),
  iferror: ev('IFERROR(1 / 0, "n/a")', {}),
  concat: ev('"Rp " & [x]', {x: 5})
};
var injection = null;
try {
  C.parse("constructor.constructor('return 1')()");
  injection = "parsed";
} catch (e) {
  injection = "rejected";
}
out.injection = injection;
out.excel = C.toExcel(C.parse("IF([Planned]>[Actual],1,0)"), function (n) {
  return n === "Planned" ? "C2" : "D2";
});
out.kit = C.promoKit({title: budget.title, price: 5, currency: "USD", category: budget.category,
                      description: budget.description, spec: budget},
                     "https://example.test/app.html?ref=aff1#/item/abc");

var book = X.build(t4.spec);
out.xlsx = X.base64(book);
out.csv = X.toCsv(budget).split("\n")[0];
out.themes = C.THEMES.length;
out.blueprints = C.BLUEPRINTS.length;
__OUT__(JSON.stringify(out));
"""


def js_runtime():
    if shutil.which("node"):
        return "node"
    if sys.platform == "darwin" and shutil.which("osascript"):
        return "osascript"
    return None


def run_js(script):
    source = "".join(read(os.path.join("js", name)) + "\n" for name in ("core.js", "xlsx.js")) + script
    runtime = js_runtime()
    if runtime == "node":
        source = source.replace("__OUT__(", "console.log(")
        suffix = ".js"
        command = ["node"]
    else:
        source = source.replace("__OUT__(", "(")
        suffix = ".js"
        command = ["osascript", "-l", "JavaScript"]
    # Run from a temp file: Linux caps a single argv string at 128 KB.
    with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False, encoding="utf-8") as handle:
        handle.write(source)
        script_path = handle.name
    try:
        result = subprocess.run(command + [script_path], capture_output=True, text=True, encoding="utf-8", timeout=90)
    finally:
        os.unlink(script_path)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])
    return json.loads(result.stdout.strip())


def budget_title_ok(kit):
    return "Budget" in kit["x"]


def js_checks():
    runtime = js_runtime()
    if runtime is None:
        print("javascript: SKIPPED (no node / osascript)")
        return
    print("javascript core via " + runtime)
    out = run_js(JS_PROBE)

    check(out["themes"] >= 8 and out["blueprints"] >= 14, "8 themes / 14 blueprints")
    inv = out["inv"]
    check(inv["blueprint"] == "inventory", "inventory prompt -> inventory blueprint")
    check(inv["currency"] == "IDR" and inv["theme"] == "ocean", "rupiah + ocean detected")
    check("Qty" in inv["columns"] and "Reorder?" in inv["columns"], "inventory columns present")
    check(out["budgetId"]["blueprint"] == "budget", "Indonesian 'anggaran' -> budget")
    lowered = [c.lower() for c in out["custom"]["columns"]]
    check(any("species" in c for c in lowered) and any("age" in c for c in lowered),
          "custom tracker picks up requested fields " + str(out["custom"]["columns"]))

    summary = {item["label"]: item["value"] for item in out["budget"]["summary"]}
    pairs = out["plannedActual"]
    planned = sum(p[0] for p in pairs)
    actual = sum(p[1] for p in pairs)
    check(out["budget"]["errors"] == 0, "budget computes without formula errors")
    check(summary.get("Total planned") == planned, "Total planned = sum(Planned) = %s" % planned)
    check(summary.get("Total spent") == actual, "Total spent = sum(Actual) = %s" % actual)
    check(summary.get("Left to spend") == planned - actual, "Left to spend = planned - actual")

    tweaks = out["tweaks"]
    check(tweaks["rows"] == out["budget"]["rows"] + 5, "'add 5 rows'")
    check(tweaks["addedId"][-1] == "Catatan", "'tambah kolom Catatan'")
    check(tweaks["theme"] == "midnight", "'theme midnight'")
    check(tweaks["formulaCol"]["type"] == "formula"
          and tweaks["formulaCol"]["formula"].replace(" ", "") == "[Planned]-[Actual]",
          "'add column Diff = [Planned] - [Actual]'")
    check("Item" not in tweaks["removed"], "'remove column Item'")
    check(tweaks["currency"] == "EUR", "'currency EUR'")
    check(tweaks["unknownChanged"] is False, "unknown command changes nothing")
    check(out["diffRows"] == [p[0] - p[1] for p in pairs], "Diff column evaluates per row")

    zh = out["zh"]
    check(zh["rowsAdded"] == 5, "zh '新增 5 行' adds rows")
    check(zh["hasGys"] is True, "zh '新增 供应商 列' adds column")
    check(zh["hasNote"] is True, "zh '新增一列 备注' adds column (一列 form)")
    check(zh["gysRemoved"] is True, "zh '删除 供应商 列' removes column")
    check("Budget" in zh["renamed"] and "Planned" not in zh["renamed"], "zh '把 Planned 改成 Budget' renames")
    check(zh["currency"] == "EUR", "zh '货币 EUR' sets currency")
    check(zh["theme"] == "midnight", "zh '主题 深色' sets theme")
    check(zh["sumAdded"] == 1 and zh["lastSum"]["column"] == "Planned" and zh["lastSum"]["fn"] == "SUM", "zh '合计 Planned' adds SUM card")
    check(zh["ruleAdded"] == 1 and zh["lastRule"]["op"] == "<" and zh["lastRule"]["style"] == "bad", "zh '高亮 … 低于 0 红色' adds red rule")
    check(zh["formula"]["type"] == "formula" and zh["formula"]["formula"].replace(" ", "") == "[Planned]-[Actual]", "zh formula column added")

    es = out["es"]
    check(es["rowsAdded"] == 5, "es 'agregar 5 filas' adds rows")
    check(es["hasPrio"] is True, "es 'agregar columna Prioridad' adds column")
    check("Presupuesto" in es["renamed"] and "Planned" not in es["renamed"], "es 'renombrar Planned a Presupuesto' renames")
    check(es["itemRemoved"] is True, "es 'eliminar Item' removes column")
    check(es["currency"] == "EUR", "es 'moneda EUR' sets currency")
    check(es["theme"] == "midnight", "es 'tema oscuro' sets theme")
    check(es["sumAdded"] == 1 and es["lastSum"]["column"] == "Planned" and es["lastSum"]["fn"] == "SUM", "es 'suma de Planned' adds SUM card")
    check(es["ruleAdded"] == 1 and es["lastRule"]["op"] == "<" and es["lastRule"]["style"] == "bad", "es 'resalta … menos que 0 rojo' adds red rule")
    check(es["typedCol"]["type"] == "number" and es["typedCol"]["name"] == "Margen", "es 'agregar columna Margen como número' adds number column")

    trad = out["trad"]
    check(trad["removedItem"] is True, "trad '刪除 Item' removes column")
    check(trad["sumAdded"] == 1 and trad["lastSum"]["column"] == "Planned" and trad["lastSum"]["fn"] == "SUM", "trad '合計 Planned' adds SUM card")
    check(trad["currency"] == "EUR", "trad '貨幣 EUR' sets currency")
    check(trad["theme"] == "midnight", "trad '主題 深色' sets theme")
    check(trad["ruleAdded"] == 1 and trad["lastRule"]["op"] == "<" and trad["lastRule"]["style"] == "bad", "trad '高亮 … 低於 0 紅色' adds red rule")
    check("Budget" in trad["renamed"] and "Planned" not in trad["renamed"], "trad '把 Planned 改為 Budget' renames")
    check(trad["hasSup"] is True, "trad '新增 供應商 欄' adds column")

    f = out["formulas"]
    check(f["arith"] == 5, "arithmetic precedence")
    check(f["power"] == 1024, "power")
    check(f["ifs"] == "Reorder", "IF with column refs")
    check(f["logic"] is True, "AND / OR / NOT")
    check(f["round"] == 2.72, "ROUND")
    check(f["minmax"] == 6, "MIN / MAX")
    check(f["abs"] == 7, "ABS")
    check(f["iferror"] == "n/a", "IFERROR catches divide by zero")
    check(f["concat"] == "Rp 5", "& concatenation")
    check(out["injection"] == "rejected", "formula parser rejects code injection")
    check(out["excel"] == "IF(C2>D2,1,0)", "toExcel translates refs")

    kit = out["kit"]
    check(set(["x", "linkedin", "tiktok", "blog", "pinterest", "whatsapp"]) <= set(kit),
          "promo kit has 6 channels")
    check(all("ref=aff1" in str(kit[k]) for k in kit),
          "promo kit embeds the affiliate link")
    check("$5.00" in kit["x"] and budget_title_ok(kit), "promo kit shows price and title")
    check(out["csv"].startswith("Category"), "CSV header row")

    data = base64.b64decode(out["xlsx"])
    check(data[:2] == b"PK", "xlsx is a zip")
    with zipfile.ZipFile(io.BytesIO(data)) as book:
        check(book.testzip() is None, "xlsx CRCs valid")
        names = book.namelist()
        for part in ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml",
                     "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]:
            check(part in names, "xlsx part: " + part)
        for name in names:
            if name.endswith(".xml") or name.endswith(".rels"):
                try:
                    minidom.parseString(book.read(name))
                    ok = True
                except Exception:
                    ok = False
                check(ok, "well-formed XML: " + name)
        sheets = "".join(book.read(n).decode("utf-8") for n in names if n.startswith("xl/worksheets/"))
        check(sheets.count("<f>") >= 200, "worksheets contain live formulas (%d)" % sheets.count("<f>"))
        check("SUM" in sheets or "SUMIFS" in sheets or "SUBTOTAL" in sheets, "dashboard aggregates")
        check("dataValidation" in sheets, "data validation present")
        check("conditionalFormatting" in sheets, "conditional formatting present")


def store_checks():
    print("store listing and legal pages")
    store = os.path.join(BASE, "store")
    with open(os.path.join(store, "README.md"), encoding="utf-8") as handle:
        listing = handle.read()
    blocks = re.findall(r"\*\*([^*]+)\*\*[^`*]*?```\n(.*?)\n```", listing, re.S)
    limits = {"App name": 30, "Nama aplikasi": 30, "Short description": 80, "Deskripsi singkat": 80,
              "Full description": 4000, "Deskripsi lengkap": 4000}
    seen = set()
    for label, text in blocks:
        for key, limit in limits.items():
            if label.startswith(key):
                seen.add(key)
                check(len(text) <= limit, "%s is %d/%d characters" % (key, len(text), limit))
    check(seen == set(limits), "all store text blocks found " + str(sorted(set(limits) - seen)))
    sizes = {
        "graphics/icon-512.png": (512, 512),
        "graphics/feature-graphic-1024x500.png": (1024, 500),
    }
    for name in ["01-market", "02-template", "03-create", "04-guides"]:
        sizes["screenshots/%s.png" % name] = (1080, 1920)
    for rel, expected in sizes.items():
        path = os.path.join(store, rel)
        with open(path, "rb") as handle:
            header = handle.read(24)
        width = int.from_bytes(header[16:20], "big")
        height = int.from_bytes(header[20:24], "big")
        check((width, height) == expected, "%s is %dx%d" % (rel, width, height))
    delete_page = read("delete-account.html")
    check("auth/login" in delete_page and "me/delete" in delete_page, "delete-account.html signs in and deletes")
    check("mailto:" in delete_page, "delete-account.html offers an email route")
    privacy = read("privacy.html")
    for phrase in ["delete-account.html", "3 × 24 hours", "outside Indonesia", "Your rights", "Children"]:
        check(phrase in privacy, "privacy covers: " + phrase)
    check("delete-account.html" in read("sw.js"), "service worker caches delete-account.html")


I18N_PROBE = """
const store = { "mint.lang": "id" };
globalThis.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
globalThis.window = { localStorage: globalThis.localStorage, navigator: { language: "en-US" } };
globalThis.document = { readyState: "loading", addEventListener() {}, documentElement: {} };
require(process.argv[2]);
const t = window.MintI18n.t;
console.log(JSON.stringify({
  lang: window.MintI18n.lang(),
  market: t("Market"),
  padded: t("  Market  "),
  sold: t("12 sold"),
  category: t("Mint Studio \u00b7 Finance"),
  unknown: t("Toko Stock Pro"),
}));
"""


def i18n_checks():
    print("language switch (EN / ID)")
    source = read("js/i18n.js")
    # index.html is Mint's front door (it forwards to Budget or here); the studio pages carry the scripts.
    for rel in ["app.html", "web.html", "mobile.html"]:
        html = read(rel)
        has_both = "js/i18n.js" in html and "js/app.js" in html
        check(has_both and html.index("js/i18n.js") < html.index("js/app.js"), rel + " loads i18n.js before app.js")
    check('"js/i18n.js"' in read("sw.js"), "service worker caches js/i18n.js")
    check('addEventListener("mint:lang"' in read("js/app.js"), "app re-renders on language change")
    check('"mint.lang"' in source, "language choice is stored under mint.lang")
    keys = re.findall(r'^    "((?:[^"\\]|\\.)*)":', source, re.M)
    check(len(keys) == len(set(keys)), "no duplicate dictionary keys (%d entries)" % len(keys))
    if not shutil.which("node"):
        print("  skip runtime translation probe (node not installed)")
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as handle:
        handle.write(I18N_PROBE)
        probe_path = handle.name
    try:
        result = subprocess.run(["node", probe_path, os.path.join(WEB, "js", "i18n.js")],
                                capture_output=True, text=True, encoding="utf-8", timeout=30)
    finally:
        os.unlink(probe_path)
    check(result.returncode == 0, "i18n.js loads outside the browser " + result.stderr[-300:])
    if result.returncode != 0:
        return
    out = json.loads(result.stdout.strip())
    check(out["lang"] == "id", "stored language is honoured")
    check(out["market"] == "Pasar", "Market -> Pasar")
    check(out["padded"] == "  Pasar  ", "surrounding whitespace is preserved")
    check(out["sold"] == "12 terjual", "counts translate inline (12 sold)")
    check(out["category"] == "Mint Studio \u00b7 Keuangan", "category label translates after a separator")
    check(out["unknown"] == "Toko Stock Pro", "unknown text falls back unchanged")


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    static_checks()
    cloud_checks()
    seed_checks()
    store_checks()
    i18n_checks()
    try:
        js_checks()
    except Exception as error:
        check(False, "javascript run: " + str(error)[:500])
    print()
    if failures:
        print("FAILED: %d check(s)" % len(failures))
        sys.exit(1)
    print("PASSED")


if __name__ == "__main__":
    main()
