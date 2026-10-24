# Loka Translate

A local Windows translation desk for English, Simplified Chinese, Traditional Chinese and Bahasa Indonesia.
Version 1.0.0. A working desktop prototype, not a certified translation service.

## Windows app

Download the Windows ZIP from https://juwpegatron.github.io/projects/loka-translate/ and extract it to a folder you will keep. Run LokaTranslate.exe. The executable bundles Python, Tk and OpenCC; it does not bundle Ollama or model weights.

Ollama must be running locally with a downloaded model. Recommended: qwen3:8b. Initial software/model downloads need internet; translation does not. No paid API or account is used. Models are never downloaded automatically by this app.

Create a desktop shortcut to the executable if desired. On Windows, open the app and right-click its taskbar icon to choose Pin to taskbar. Moving/deleting the executable breaks shortcuts.

## Features

- Explicit source selection or model-based auto detection; four target language/script choices.
- Natural, Professional, Friendly, Formal and Literal tone.
- Optional context and a per-session glossary: one `source term = preferred translation` per line.
- Streaming translation, on-demand alternatives and English word-choice notes.
- Deterministic Chinese script conversion with OpenCC. Traditional uses Taiwan vocabulary.
- Review warnings for changed numeric tokens, missing URLs and missing preferred terminology. These checks are limited heuristics, not proof of fidelity.
- Copy and explicit UTF-8 export. No translation-history database or analytics.
- Ctrl+Enter to translate, Escape to request stop. Cancellation can wait for the next local response.

## Privacy and limitations

The app only sends requests to http://127.0.0.1:11434 and ignores environment HTTP proxies. Cloud-tagged models are excluded. Use genuinely local models; a custom model name is not an independent security audit of Ollama. There is no network fallback, web translation service, telemetry or API key.

Source text, context, glossary and results are kept in process memory, not saved by the app. Clear removes the current session text and undo history; it does not securely erase RAM, the Windows clipboard, exported files, OS pagefiles or Ollama diagnostics. Clipboard content is managed by Windows. Do not paste confidential data unless your local Ollama configuration and PC are approved for it.

AI translations can omit details, mishandle ambiguity, ignore terminology or follow embedded instructions despite prompt safeguards. Review legal, medical, safety-critical and business-critical text. No benchmark establishes superiority to Google Translate. This release translates pasted text, not audio, images, Teams captions or whole documents. No browser/mobile translator is claimed.

The limit is 4,000 source characters per request; context and glossary are each limited to 1,000 characters. Use shorter passages for better control and faster results. Response time depends on hardware, model loading and output length. Numbers/URLs are prompted for preservation, not silently rewritten after generation.

## Run from source

Use Python 3.10+ with Tk. From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

## Tests

```powershell
python -m unittest test_app -v
$env:LOKA_GUI = '1'       # optional: creates the real Tk window
$env:LOKA_LIVE = '1'      # optional: uses installed local qwen3:8b
python -m unittest test_app -v
```

The live smoke suite checks all 12 directed pairs between the four language/script choices using a short scheduling sentence, plus a glossary request and structured insights. It is a functional smoke test, not an independent translation-quality benchmark.

## Build a standalone Windows executable

```powershell
python -m pip install pyinstaller==6.16.0
python -m PyInstaller --noconfirm --clean --onefile --windowed --name LokaTranslate --icon loka.ico --add-data "loka.ico;." --collect-all opencc app.py
```

The distributed executable is unsigned. Verify the published SHA-256 and inspect the source rather than disabling Windows security protections.

## Credits

Python and Tk power the interface; Ollama runs separately with user-installed models. OpenCC conversion data and opencc-python-reimplemented are Apache-2.0 licensed. Third-party notices accompany the Windows download. Application source follows the parent repository license. Local model licenses remain separate.
