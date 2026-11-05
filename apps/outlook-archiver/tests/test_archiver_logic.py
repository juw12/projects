"""tests/test_archiver_logic.py -- stdlib-only tests for outlook_archiver.py's logic.

The Windows-only modules (win32com, pythoncom, win32api, winotify) are replaced with stubs and
Outlook objects with small fakes, so this runs anywhere. The log goes to a temp file through
the OUTLOOK_ARCHIVER_LOG override. Exits 0 on success.

Run:  python apps/outlook-archiver/tests/test_archiver_logic.py
"""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
_TMP = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
os.environ["OUTLOOK_ARCHIVER_LOG"] = str(Path(_TMP.name) / "archive.log")

# --- stub the Windows-only imports before loading the module -------------------
win32com = types.ModuleType("win32com")
win32com.client = types.ModuleType("win32com.client")
winotify = types.ModuleType("winotify")
winotify.Notification = object
winotify.audio = types.SimpleNamespace(Default=None)
for name, module in {
    "win32com": win32com,
    "win32com.client": win32com.client,
    "pythoncom": types.ModuleType("pythoncom"),
    "win32api": types.ModuleType("win32api"),
    "winotify": winotify,
}.items():
    sys.modules.setdefault(name, module)

spec = importlib.util.spec_from_file_location("outlook_archiver", APP_DIR / "outlook_archiver.py")
oa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oa)


class FakeFolder:
    def __init__(self, name, children=()):
        self.Name = name
        self.Folders = FakeFolders(list(children))


class FakeFolders(list):
    def Add(self, name):
        folder = FakeFolder(name)
        self.append(folder)
        return folder


class FakeMail:
    Class = 43

    def __init__(self, **fields):
        self.UnRead = True
        self.saved = False
        self.moved_to = None
        self.__dict__.update(fields)

    def Save(self):
        self.saved = True

    def Move(self, folder):
        self.moved_to = folder


class TextHelperTests(unittest.TestCase):
    def test_collapse_and_truncate(self):
        self.assertEqual(oa._collapse_ws("  a \n\t b  "), "a b")
        self.assertEqual(oa._collapse_ws(None), "")
        self.assertEqual(oa._truncate("hello world", 20), "hello world")
        cut = oa._truncate("hello world", 6)
        self.assertEqual(len(cut), 6)
        self.assertTrue(cut.endswith("\u2026"))
        self.assertEqual(oa._truncate("abc", 0), "\u2026")

    def test_sender_and_recipients(self):
        self.assertEqual(oa._safe_sender(FakeMail(SenderName="Ana", SenderEmailAddress="a@x.io")), "Ana <a@x.io>")
        self.assertEqual(oa._safe_sender(FakeMail(SenderName="", SenderEmailAddress="a@x.io")), "a@x.io")
        self.assertEqual(oa._safe_sender(object()), "")  # COM errors never escape
        self.assertEqual(oa._safe_recipients(FakeMail(To="b@x.io", CC="")), "To: b@x.io")
        self.assertEqual(oa._safe_recipients(FakeMail(To="b@x.io", CC="c@x.io")), "To: b@x.io | Cc: c@x.io")
        self.assertEqual(oa._safe_recipients(FakeMail(To="", CC="")), "")

    def test_body_prefers_plain_text(self):
        self.assertEqual(oa._safe_body(FakeMail(Body="plain", HTMLBody="<b>x</b>")), "plain")
        self.assertEqual(oa._safe_body(FakeMail(Body="", HTMLBody="<b>x</b>")), "[html]\n<b>x</b>")
        self.assertEqual(oa._safe_body(object()), "")


class FolderTests(unittest.TestCase):
    def test_get_or_create_child_is_case_insensitive_and_creates_once(self):
        inbox = FakeFolder("Inbox")
        root = FakeFolder("root", [inbox])
        self.assertIs(oa._get_or_create_child(root, "INBOX"), inbox)
        sent = oa._get_or_create_child(root, "Sent Items")
        self.assertEqual(sent.Name, "Sent Items")
        self.assertIs(oa._get_or_create_child(root, "sent items"), sent)
        self.assertEqual(len(root.Folders), 2)

    def test_inbox_mail_is_marked_read_then_moved(self):
        mail = FakeMail()
        target = FakeFolder("Inbox")
        oa._archive_in_outlook(mail, target, "INBOX")
        self.assertFalse(mail.UnRead)
        self.assertTrue(mail.saved)
        self.assertIs(mail.moved_to, target)

    def test_sent_mail_is_moved_without_touching_read_state(self):
        mail = FakeMail()
        oa._archive_in_outlook(mail, FakeFolder("Sent Items"), "SENT")
        self.assertTrue(mail.UnRead)
        self.assertFalse(mail.saved)


class NewMailTests(unittest.TestCase):
    def setUp(self):
        self.archive = FakeFolder("Inbox")
        self.items = {}
        namespace = types.SimpleNamespace(GetItemFromID=lambda entry_id: self.items[entry_id])
        oa.outlook = types.SimpleNamespace(GetNamespace=lambda _name: namespace)
        oa.archive_inbox_folder = self.archive
        oa._suppress_toasts = True

    def test_new_mail_is_archived(self):
        mail = FakeMail(Subject="Hi", SenderName="Ana", SenderEmailAddress="a@x.io", Body="body")
        self.items["id1"] = mail
        oa.handle_new_mail("id1")
        self.assertIs(mail.moved_to, self.archive)
        self.assertFalse(mail.UnRead)

    def test_non_mail_items_are_left_alone(self):
        meeting = FakeMail(Subject="Invite")
        meeting.Class = 53  # meeting request, not olMail
        self.items["id2"] = meeting
        oa.handle_new_mail("id2")
        self.assertIsNone(meeting.moved_to)

    def test_unknown_entry_id_does_not_raise(self):
        oa.handle_new_mail("missing")  # KeyError from GetItemFromID is swallowed and logged


class ConfigTests(unittest.TestCase):
    def test_log_location_is_configurable_and_not_hard_coded(self):
        self.assertEqual(oa.LOG_FILE, os.environ["OUTLOOK_ARCHIVER_LOG"])
        source = (APP_DIR / "outlook_archiver.py").read_text(encoding="utf-8")
        self.assertNotRegex(source, r"[Cc]:\\+[Uu]sers\\+[A-Za-z]")


if __name__ == "__main__":
    unittest.main(verbosity=1)
