# Google AI Studio is Blocked — Use These Instead

Your network blocks aistudio.google.com. Here are 3 alternatives that usually work, plus 1 fully-offline option.

## Option 1: HuggingChat (most likely to work)
- URL: https://huggingface.co/chat/
- Free, no account needed
- Uses open-source models (Llama, Mistral, etc.)
- Chat interface works exactly like Google AI Studio

## Option 2: Le Chat (Mistral)
- URL: https://chat.mistral.ai/
- Free, just needs email signup
- Uses Mistral models (very capable)

## Option 3: Microsoft Copilot
- URL: https://copilot.microsoft.com/
- Often whitelisted in corporate networks
- Free with Microsoft account

## Option 4: Fully offline (Ollama — requires setup)
For when nothing online works:
- Download Ollama from https://ollama.com
- Run `ollama pull llama3.2` in PowerShell
- Run `ollama serve` in another window
- Chat at http://localhost:11434

This is fully offline, no network needed.

---

## How to use any of these with the PostPilot prompt system

The prompt files (00-04 in `prompts/`) work in ANY chat AI. Just:

1. Open your alternative AI chat
2. Paste the System Instructions from `prompts/01-weekly-generator.md` as your "system prompt" or first message
3. Paste the Voice Profile + Topics from the user message template
4. Click send

The output should be identical to Google AI Studio. If you find a specific alternative works better, edit the prompts to suit.

## Quick test to find what works

Try this in each AI:
```
Write a 50-word LinkedIn post about why most coaches underprice their services.
```

Whichever gives the best output, use that for PostPilot.
