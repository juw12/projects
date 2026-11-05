"""tests/test_updater_shop.py -- stdlib-only tests for updater.py, pet_shop.py rules and tama.py.

The updater is exercised end to end against a temporary app folder with an in-memory
release zip (``updater._get`` is patched, so there is no network). Exits 0 on success.

Run:  python apps/pips/tests/test_updater_shop.py
"""

from __future__ import annotations

import hashlib
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

PIPS_DIR = Path(__file__).resolve().parent.parent
if str(PIPS_DIR) not in sys.path:
    sys.path.insert(0, str(PIPS_DIR))

import pet_shop  # noqa: E402
import tama  # noqa: E402
import updater  # noqa: E402


def make_zip(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, text in files.items():
            archive.writestr(name, text)
    return buffer.getvalue()


class VersionTests(unittest.TestCase):
    def test_parse_version_normalises(self):
        self.assertEqual(updater.parse_version("v2.18.1"), (2, 18, 1))
        self.assertEqual(updater.parse_version("2.18"), (2, 18, 0))
        self.assertEqual(updater.parse_version("2.18.1-beta"), (2, 18, 1))
        self.assertEqual(updater.parse_version(""), (0, 0, 0))
        self.assertEqual(updater.parse_version(None), (0, 0, 0))
        self.assertEqual(updater.parse_version("1.2.3.4"), (1, 2, 3))

    def test_is_newer_compares_numerically(self):
        self.assertTrue(updater.is_newer("2.10.0", "2.9.9"))
        self.assertFalse(updater.is_newer("2.9.9", "2.10.0"))
        self.assertFalse(updater.is_newer("2.18.1", "v2.18.1"))

    def test_notes_for_language_fallback(self):
        manifest = {"notes": {"en": ["fixed"], "id": ["diperbaiki"]}}
        self.assertEqual(updater.notes_for(manifest, "id"), ["diperbaiki"])
        self.assertEqual(updater.notes_for(manifest, "zh"), ["fixed"])
        self.assertEqual(updater.notes_for({"notes": ["a"]}, "id"), ["a"])
        self.assertEqual(updater.notes_for({}, "en"), [])

    def test_check_only_returns_newer_manifest(self):
        manifest = {"version": "3.0.0", "url": "https://example.invalid/p.zip"}
        with mock.patch.object(updater, "fetch_manifest", return_value=manifest):
            self.assertEqual(updater.check("2.0.0"), manifest)
            self.assertIsNone(updater.check("3.0.0"))

    def test_fetch_manifest_rejects_incomplete(self):
        with mock.patch.object(updater, "_get", return_value=b'{"version": "1.0.0"}'):
            with self.assertRaises(ValueError):
                updater.fetch_manifest("https://example.invalid/latest.json")


class InstallTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.app_dir = Path(self._tmp.name) / "Pips"
        self.app_dir.mkdir()
        (self.app_dir / "app.py").write_text("OLD", encoding="utf-8")
        (self.app_dir / "config.json").write_text('{"mine": true}', encoding="utf-8")
        (self.app_dir / "data").mkdir()
        (self.app_dir / "data" / "productivity.db").write_text("DB", encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def install(self, payload: bytes, sha256: str | None = "auto"):
        manifest = {"version": "9.9.9", "url": "https://example.invalid/Pips.zip"}
        if sha256 == "auto":
            manifest["sha256"] = hashlib.sha256(payload).hexdigest()
        elif sha256:
            manifest["sha256"] = sha256
        with mock.patch.object(updater, "_get", return_value=payload):
            return updater.install(manifest, self.app_dir, "1.0.0")

    def test_install_replaces_code_backs_up_and_keeps_user_data(self):
        payload = make_zip({
            "Pips/app.py": "NEW",
            "Pips/coach.py": "COACH",
            "Pips/config.json": '{"shipped": true}',
            "Pips/data/productivity.db": "EMPTY",
        })
        backup = Path(self.install(payload))
        self.assertEqual((self.app_dir / "app.py").read_text(encoding="utf-8"), "NEW")
        self.assertEqual((self.app_dir / "coach.py").read_text(encoding="utf-8"), "COACH")
        # protected user files are never overwritten
        self.assertEqual((self.app_dir / "config.json").read_text(encoding="utf-8"), '{"mine": true}')
        self.assertEqual((self.app_dir / "data" / "productivity.db").read_text(encoding="utf-8"), "DB")
        # the replaced file is backed up
        self.assertEqual((backup / "app.py").read_text(encoding="utf-8"), "OLD")

    def test_flat_zip_without_top_folder_installs(self):
        self.install(make_zip({"app.py": "FLAT"}))
        self.assertEqual((self.app_dir / "app.py").read_text(encoding="utf-8"), "FLAT")

    def test_checksum_mismatch_cancels_without_touching_files(self):
        with self.assertRaises(ValueError):
            self.install(make_zip({"Pips/app.py": "NEW"}), sha256="0" * 64)
        self.assertEqual((self.app_dir / "app.py").read_text(encoding="utf-8"), "OLD")

    def test_manifest_without_checksum_is_refused(self):
        with self.assertRaises(ValueError):
            self.install(make_zip({"Pips/app.py": "NEW"}), sha256=None)
        self.assertEqual((self.app_dir / "app.py").read_text(encoding="utf-8"), "OLD")

    def test_published_manifest_keeps_its_checksum(self):
        import json

        published = PIPS_DIR / "web" / "download" / "latest.json"
        if not published.exists():
            self.skipTest("web/download/latest.json not checked out")
        manifest = json.loads(published.read_text(encoding="utf-8-sig"))
        self.assertTrue(manifest.get("version"))
        self.assertTrue(manifest.get("url", "").startswith("https://"))
        self.assertRegex(manifest.get("sha256", ""), r"^[0-9a-f]{64}$")

    def test_zip_slip_is_rejected(self):
        payload = make_zip({"Pips/app.py": "NEW", "../../evil.py": "x"})
        with self.assertRaises(ValueError):
            self.install(payload)
        self.assertEqual((self.app_dir / "app.py").read_text(encoding="utf-8"), "OLD")
        self.assertFalse((Path(self._tmp.name) / "evil.py").exists())

    def test_archive_without_app_py_is_rejected(self):
        with self.assertRaises(ValueError):
            self.install(make_zip({"Pips/readme.txt": "hi"}))

    def test_developer_copy_is_never_overwritten(self):
        (self.app_dir / "release.py").write_text("", encoding="utf-8")
        with self.assertRaises(RuntimeError):
            self.install(make_zip({"Pips/app.py": "NEW"}))
        self.assertEqual((self.app_dir / "app.py").read_text(encoding="utf-8"), "OLD")


class FighterTests(unittest.TestCase):
    def test_level_is_clamped(self):
        self.assertEqual(pet_shop.fighter_stats(0, {})["level"], 1)
        self.assertEqual(pet_shop.fighter_stats(500, {})["level"], 99)
        self.assertEqual(pet_shop.fighter_stats(None, None)["level"], 1)

    def test_base_stats_grow_with_level(self):
        low = pet_shop.fighter_stats(1, {})
        high = pet_shop.fighter_stats(50, {})
        for stat in ("hp", "atk", "def", "spd", "power"):
            self.assertGreater(high[stat], low[stat], stat)
        self.assertEqual(low["weapon_kind"], "paw")

    def test_gear_in_wrong_slot_or_unknown_is_ignored(self):
        base = pet_shop.fighter_stats(10, {})
        weapon = next(k for k, v in pet_shop.GEAR.items() if v[0] == "weapon")
        self.assertEqual(pet_shop.fighter_stats(10, {"armor": weapon}), base)
        self.assertEqual(pet_shop.fighter_stats(10, {"weapon": "no_such_item"}), base)
        equipped = pet_shop.fighter_stats(10, {"weapon": weapon})
        self.assertGreater(equipped["atk"], base["atk"])

    def test_crit_is_capped_at_40(self):
        best = {}
        for slot in pet_shop.GEAR_SLOTS:
            items = [k for k, v in pet_shop.GEAR.items() if v[0] == slot]
            best[slot] = max(items, key=lambda k: pet_shop.GEAR[k][2].get("crit", 0))
        self.assertLessEqual(pet_shop.fighter_stats(99, best)["crit"], 40.0)

    def test_clean_skills_always_three_unique_usable(self):
        for picks in ([], ["strike"], ["fury", "fury", "fury"], ["bogus", "heavy"], list(pet_shop.SKILLS)):
            for level in (1, 50, 99):
                skills = pet_shop.clean_skills(picks, level, {})
                self.assertEqual(len(skills), 3, (picks, level))
                self.assertEqual(len(set(skills)), 3, (picks, level))
                for skill in skills:
                    self.assertTrue(
                        skill in pet_shop.DEFAULT_SKILLS or pet_shop.skill_unlocked(skill, level, {}),
                        (skill, level),
                    )

    def test_level_locked_skill_needs_level(self):
        locked = [s for s, v in pet_shop.SKILLS.items() if isinstance(v[1], int) and v[1] > 1]
        self.assertTrue(locked)
        skill = locked[0]
        need = pet_shop.SKILLS[skill][1]
        self.assertFalse(pet_shop.skill_unlocked(skill, need - 1, {}))
        self.assertTrue(pet_shop.skill_unlocked(skill, need, {}))
        self.assertFalse(pet_shop.skill_unlocked("no_such_skill", 99, {}))


class LookTests(unittest.TestCase):
    def test_clean_look_keeps_only_valid_props_in_their_slot(self):
        head = next(k for k, v in pet_shop.PROPS.items() if v[0] == "head")
        look = {"head": head, "face": head, "neck": 42, "moves": ["spin", "hack", "dance"] + ["spin"] * 20}
        cleaned = pet_shop.clean_look(look)
        self.assertEqual(cleaned["head"], head)
        self.assertNotIn("face", cleaned)
        self.assertNotIn("neck", cleaned)
        self.assertNotIn("hack", cleaned["moves"])
        self.assertLessEqual(len(cleaned["moves"]), 10)
        self.assertEqual(pet_shop.clean_look("not a dict"), {})

    def test_clean_traits_whitelists_values(self):
        self.assertEqual(
            pet_shop.clean_traits({"gender": "girl", "stage": "teen", "owner_gender": "m"}),
            {"gender": "girl", "stage": "teen", "owner_gender": "m"},
        )
        self.assertEqual(pet_shop.clean_traits({"gender": "<script>", "stage": "adult"}), {})
        self.assertEqual(pet_shop.clean_traits(None), {})


class TamaTests(unittest.TestCase):
    def test_stage_thresholds(self):
        self.assertEqual(tama.stage_for(0), "baby")
        self.assertEqual(tama.stage_for(1.99), "baby")
        self.assertEqual(tama.stage_for(2), "child")
        self.assertEqual(tama.stage_for(6), "teen")
        self.assertEqual(tama.stage_for(12), "adult")
        self.assertEqual(tama.stage_for(1000), "adult")

    def test_cleaners(self):
        self.assertEqual(tama.clean_stage("teen"), "teen")
        self.assertEqual(tama.clean_stage("dragon"), "adult")
        self.assertEqual(tama.clean_gender("boy"), "boy")
        self.assertEqual(tama.clean_gender("x"), "")
        self.assertEqual(tama.gender_symbol("m"), tama.gender_symbol("boy"))
        self.assertEqual(tama.gender_symbol("?"), "")

    def test_game_reward_daily_cap_resets_next_day(self):
        state = {}
        coins = [tama.game_reward(state, True, "2026-01-01") for _ in range(tama.GAME_REWARDS_PER_DAY + 2)]
        self.assertEqual(coins[: tama.GAME_REWARDS_PER_DAY], [tama.GAME_COINS] * tama.GAME_REWARDS_PER_DAY)
        self.assertEqual(coins[tama.GAME_REWARDS_PER_DAY:], [0, 0])
        self.assertEqual(tama.game_reward(state, False, "2026-01-02"), 0)
        self.assertEqual(tama.game_reward(state, True, "2026-01-02"), tama.GAME_COINS)


if __name__ == "__main__":
    unittest.main(verbosity=1)
