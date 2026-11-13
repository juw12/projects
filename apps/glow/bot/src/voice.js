// Voice notes: Telegram voice message -> text with Cloudflare Workers AI Whisper (free daily allowance).
//
// Telegram sends voice notes as OGG/Opus. Cloudflare documents WAV and MP3 for Whisper and a Worker
// cannot transcode audio, so two models are tried in turn (large-v3-turbo with base64, then the base
// model with raw bytes) and a clear "please type it" comes back when neither can read the note.

import { clip, errorText, withTimeout } from "./util.js";

export const MAX_VOICE_SECONDS = 180; // about 140 neurons per note at ~47 neurons per audio minute
export const MAX_VOICE_BYTES = 4 * 1024 * 1024;
const TELEGRAM = "https://api.telegram.org";

export class VoiceError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "VoiceError";
    this.code = code; // "no-ai" | "too-long" | "too-big" | "download" | "unreadable" | "empty"
  }
}

export const VOICE_MODELS = [
  { id: "@cf/openai/whisper-large-v3-turbo", input: (bytes) => ({ audio: toBase64(bytes), task: "transcribe" }) },
  { id: "@cf/openai/whisper", input: (bytes) => ({ audio: Array.from(bytes) }) },
];

export function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
}

// The text in a Whisper answer, whichever field the model used.
export function readTranscript(output) {
  if (!output) return "";
  if (typeof output === "string") return output.trim();
  if (typeof output.text === "string") return output.text.trim();
  if (output.result && typeof output.result.text === "string") return output.result.text.trim();
  if (Array.isArray(output.segments)) return output.segments.map((segment) => segment.text || "").join(" ").trim();
  return "";
}

// Download a Telegram file by its file_id. Returns a Uint8Array.
export async function downloadTelegramFile({ fetch, token, fileId, maxBytes = MAX_VOICE_BYTES, timeoutMs = 20000 }) {
  const info = await withTimeout(
    async (signal) => {
      const response = await fetch(`${TELEGRAM}/bot${token}/getFile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
        signal,
      });
      return response.json().catch(() => null);
    },
    timeoutMs,
    "Telegram getFile",
  );
  const path = info && info.ok && info.result && info.result.file_path;
  if (!path) throw new VoiceError("download", clip((info && info.description) || "no file path", 120));
  if (info.result.file_size && info.result.file_size > maxBytes) throw new VoiceError("too-big");
  const bytes = await withTimeout(
    async (signal) => {
      const response = await fetch(`${TELEGRAM}/file/bot${token}/${path}`, { signal });
      if (!response.ok) throw new VoiceError("download", `HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    timeoutMs,
    "Telegram file download",
  );
  if (bytes.length > maxBytes) throw new VoiceError("too-big");
  return bytes;
}

// voice = Telegram's message.voice (or message.audio): { file_id, duration, file_size, mime_type }.
// Returns { text, model }. Throws VoiceError with a code the chat turns into a friendly sentence.
export async function transcribeVoice({ fetch, ai, token, voice, timeoutMs = 60000 }) {
  if (!ai) throw new VoiceError("no-ai");
  if (!voice || !voice.file_id) throw new VoiceError("download", "no file");
  if ((voice.duration || 0) > MAX_VOICE_SECONDS) throw new VoiceError("too-long");
  if ((voice.file_size || 0) > MAX_VOICE_BYTES) throw new VoiceError("too-big");
  const bytes = await downloadTelegramFile({ fetch, token, fileId: voice.file_id });
  const problems = [];
  for (const model of VOICE_MODELS) {
    try {
      const output = await withTimeout(() => ai.run(model.id, model.input(bytes)), timeoutMs, "Whisper");
      const text = readTranscript(output);
      if (text) return { text: clip(text, 4000), model: model.id };
      problems.push(`${model.id}: empty`);
    } catch (error) {
      problems.push(`${model.id}: ${clip(errorText(error), 100)}`);
    }
  }
  const allEmpty = problems.every((problem) => problem.endsWith(": empty"));
  throw new VoiceError(allEmpty ? "empty" : "unreadable", problems.join(" | "));
}
