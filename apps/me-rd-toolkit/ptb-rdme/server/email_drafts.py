"""Outlook COM wrappers for the email-drafts panel.

These helpers work only when the widget is running on a PC with Outlook
desktop installed and signed in. The central server (LAN-shared) returns a
graceful "not available" response when COM is missing.
"""
from __future__ import annotations

from typing import Any


def _coinit() -> None:
    try:
        import pythoncom  # type: ignore
        try:
            pythoncom.CoInitialize()
        except Exception:
            pass
    except ImportError:
        pass


def _session():
    import win32com.client  # type: ignore
    _coinit()
    app = win32com.client.Dispatch("Outlook.Application")
    ns = app.GetNamespace("MAPI")
    return app, ns


def list_recent_drafts(limit: int = 20) -> list[dict]:
    """Return recent items from the user's Outlook Drafts folder."""
    try:
        _app, ns = _session()
        drafts = ns.GetDefaultFolder(16)  # olFolderDrafts
        items = drafts.Items
        try:
            items.Sort("[CreationTime]", True)
        except Exception:
            pass
        out: list[dict] = []
        for i in range(1, min(limit, items.Count) + 1):
            try:
                it = items.Item(i)
                out.append(
                    {
                        "entry_id": getattr(it, "EntryID", ""),
                        "subject": getattr(it, "Subject", ""),
                        "to": getattr(it, "To", "") or "",
                        "cc": getattr(it, "CC", "") or "",
                        "creation_time": str(getattr(it, "CreationTime", "") or ""),
                        "body_preview": ((getattr(it, "Body", "") or "")[:200]).replace("\n", " ").strip(),
                    }
                )
            except Exception:
                continue
        return out
    except Exception as e:
        return [{"error": str(e)}]


def get_inbox_unread_count() -> int:
    try:
        _app, ns = _session()
        inbox = ns.GetDefaultFolder(6)
        items = inbox.Items
        n = 0
        for i in range(1, items.Count + 1):
            try:
                if getattr(items.Item(i), "UnRead", False):
                    n += 1
            except Exception:
                continue
        return n
    except Exception:
        return -1
