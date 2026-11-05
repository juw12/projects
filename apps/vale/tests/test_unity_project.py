"""tests/test_unity_project.py -- static checks for the Vale Unity project (stdlib only).

Unity itself cannot run in CI, so these guard the mistakes that break a Unity build or scene:
  * a script file whose name is not the type inside it (Unity cannot attach/serialise it),
  * `using UnityEditor` in runtime code without #if UNITY_EDITOR (player builds fail),
  * assembly-definition references with no matching package in Packages/manifest.json,
  * Input System actions looked up by name that do not exist in ValeInput.inputactions,
  * namespaces outside the asmdef's root namespace, and unbalanced braces.
Run:  python apps/vale/tests/test_unity_project.py
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

VALE = Path(__file__).resolve().parent.parent
SCRIPTS = VALE / "Assets" / "Vale" / "Scripts"
CS_FILES = sorted(SCRIPTS.rglob("*.cs"))

# asmdef assembly -> UPM package that provides it
ASSEMBLY_PACKAGES = {
    "Unity.RenderPipelines.HighDefinition.Runtime": "com.unity.render-pipelines.high-definition",
    "Unity.RenderPipelines.HighDefinition.Editor": "com.unity.render-pipelines.high-definition",
    "Unity.RenderPipelines.Core.Runtime": "com.unity.render-pipelines.core",
    "Unity.Cinemachine": "com.unity.cinemachine",
    "Unity.Cinemachine.Editor": "com.unity.cinemachine",
    "Unity.InputSystem": "com.unity.inputsystem",
    "Unity.VisualEffectGraph.Runtime": "com.unity.visualeffectgraph",
    "Unity.TextMeshPro": "com.unity.ugui",  # TextMeshPro ships inside uGUI 2.x (Unity 6)
    "UnityEngine.UI": "com.unity.ugui",
}


def strip_code(text: str) -> str:
    """Remove comments and string/char literals so braces and keywords can be counted."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"//[^\n]*", "", text)
    text = re.sub(r'@"(?:[^"]|"")*"', '""', text)
    text = re.sub(r'\$?"(?:\\.|[^"\\])*"', '""', text)
    return re.sub(r"'(?:\\.|[^'\\])'", "''", text)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


class ScriptTests(unittest.TestCase):
    def test_project_has_scripts(self):
        self.assertGreater(len(CS_FILES), 20)

    def test_file_name_matches_a_declared_type(self):
        for path in CS_FILES:
            code = strip_code(path.read_text(encoding="utf-8-sig"))
            types = re.findall(r"\b(?:class|interface|struct|enum)\s+(\w+)", code)
            self.assertIn(path.stem, types, f"{path.relative_to(VALE)} declares {types}")

    def test_braces_are_balanced(self):
        for path in CS_FILES:
            code = strip_code(path.read_text(encoding="utf-8-sig"))
            self.assertEqual(code.count("{"), code.count("}"), str(path.relative_to(VALE)))

    def test_runtime_code_does_not_use_unity_editor(self):
        for path in CS_FILES:
            if "Editor" in path.relative_to(SCRIPTS).parts:
                continue
            raw = path.read_text(encoding="utf-8-sig")
            for match in re.finditer(r"^\s*using\s+UnityEditor\b", raw, re.M):
                before = raw[: match.start()]
                opened = len(re.findall(r"#if\s+UNITY_EDITOR", before))
                closed = len(re.findall(r"#endif", before))
                self.assertGreater(opened, closed, f"unguarded UnityEditor in {path.relative_to(VALE)}")

    def test_namespaces_follow_the_assembly_roots(self):
        for path in CS_FILES:
            code = strip_code(path.read_text(encoding="utf-8-sig"))
            namespace = re.search(r"namespace\s+([\w.]+)", code)
            self.assertIsNotNone(namespace, f"no namespace in {path.relative_to(VALE)}")
            if "Editor" in path.relative_to(SCRIPTS).parts:
                self.assertTrue(namespace.group(1).startswith("Vale.Editor"), path.name)
            else:
                self.assertTrue(namespace.group(1).startswith("Vale."), path.name)


class AssemblyTests(unittest.TestCase):
    def setUp(self):
        self.asmdefs = {p: load_json(p) for p in SCRIPTS.rglob("*.asmdef")}
        self.packages = load_json(VALE / "Packages" / "manifest.json")["dependencies"]

    def test_every_reference_resolves(self):
        local = {a["name"] for a in self.asmdefs.values()}
        for path, asmdef in self.asmdefs.items():
            for ref in asmdef["references"]:
                if ref in local:
                    continue
                self.assertIn(ref, ASSEMBLY_PACKAGES, f"{path.name}: unknown assembly {ref}")
                self.assertIn(ASSEMBLY_PACKAGES[ref], self.packages, f"{path.name}: {ref} needs its package")

    def test_runtime_assembly_never_references_editor_assemblies(self):
        runtime = next(a for a in self.asmdefs.values() if a["name"] == "Vale.Runtime")
        self.assertFalse([r for r in runtime["references"] if r.endswith(".Editor")])
        self.assertEqual(runtime["includePlatforms"], [])

    def test_editor_assembly_is_editor_only(self):
        editor = next(a for a in self.asmdefs.values() if a["name"] == "Vale.Editor")
        self.assertEqual(editor["includePlatforms"], ["Editor"])
        self.assertIn("Vale.Runtime", editor["references"])


class InputTests(unittest.TestCase):
    def test_actions_used_in_code_exist(self):
        asset = load_json(VALE / "Assets" / "Vale" / "Settings" / "ValeInput.inputactions")
        maps = {m["name"]: {a["name"] for a in m["actions"]} for m in asset["maps"]}
        all_actions = set().union(*maps.values())
        used_maps, used_actions = set(), set()
        for path in CS_FILES:
            raw = path.read_text(encoding="utf-8-sig")
            used_maps.update(re.findall(r'FindActionMap\(\s*"([^"]+)"', raw))
            used_actions.update(re.findall(r'FindAction\(\s*"([^"]+)"', raw))
        self.assertTrue(used_actions, "expected the input manager to look actions up by name")
        self.assertFalse(used_maps - set(maps), f"missing action maps: {used_maps - set(maps)}")
        unknown = {a for a in used_actions - all_actions if a not in maps}
        self.assertFalse(unknown, f"missing actions: {unknown}")


class ProjectTests(unittest.TestCase):
    def test_editor_version_is_unity_6(self):
        text = (VALE / "ProjectSettings" / "ProjectVersion.txt").read_text(encoding="utf-8")
        self.assertRegex(text, r"\b6000\.\d+\.\d+")

    def test_manifest_pins_every_package(self):
        for name, version in load_json(VALE / "Packages" / "manifest.json")["dependencies"].items():
            self.assertRegex(version, r"^\d+\.\d+\.\d+", f"{name} is not pinned: {version}")


if __name__ == "__main__":
    unittest.main(verbosity=1)
