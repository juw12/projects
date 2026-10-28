# Lingua share kit

Tools for handing Lingua to colleagues and keeping them up to date.

| File | What it does |
| --- | --- |
| `build_guide.py` | Builds the installation & usage guide deck (`../../docs/Lingua_Installation_and_Usage_Guide.pptx`). |
| `lingua_deck.py` | Slide library used by both tools: guide slides plus update slides (how to update, what's new, version history). |
| `notifier/lingua_update_notifier.py` | Watches the GitHub releases of Lingua and, when a new `lingua-vX.Y.Z` release is fully published, replies-all in your original Outlook e-mail thread with the changes, the version history and an update deck. |
| `img/` | Screenshots used in the decks (the phone pairing link is blurred). |

Requirements: Windows, Python 3 with `python-pptx`, `Pillow`, `requests` and `pywin32`, and Outlook desktop.

## Guide deck

```powershell
pip install python-pptx pillow
python build_guide.py              # version comes from engine/version.py
```

## Update e-mails

1. Send the first e-mail yourself (guide deck + your `lingua.env` without any API key).
2. Copy `notifier/config.example.json` to `notifier/config.json` and fill in the recipients, the exact subject of that
   e-mail, your greeting/signature and, if needed, your proxy. `config.json` is git-ignored.
3. Create `notifier/state.json` with the version you already announced:
   `{"last_notified_version": "2.3.1", "thread_started": "2026-10-28T08:55"}`
4. Test without sending anything:

   ```powershell
   python notifier/lingua_update_notifier.py --status
   python notifier/lingua_update_notifier.py --dry-run --pretend-last 2.2.2   # saves a .msg preview, never sends
   ```

5. Schedule it hourly (Task Scheduler, run only when logged on, `pythonw.exe notifier/lingua_update_notifier.py`).

Safety rules built in: at most one e-mail per version; a release must have its `Lingua-windows*.zip` uploaded and be
at least `settle_minutes` old (quick hotfixes collapse into one e-mail); it only replies inside the original thread
(searched in every store, including PST archives) and never starts a new one; `--pretend-last` only works with
`--dry-run` / `--status`.

The "What's new" text comes from the GitHub release notes, so write release notes as bullet points.
