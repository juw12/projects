// apps/airiz-motor/release-relay/src/index.ts
//
// AIRIZ Motor Console — Unified Release Manifest Relay (Cloudflare Worker)
//
// Serves the signed airiz-release manifest from R2 to all 5 AIRIZ surfaces:
//   - electron-updater (Windows / macOS / Linux desktop)
//   - Capawesome Live Update (Android / iOS Capacitor)
//   - Workbox service worker (PWA)
//   - wrangler versions deploy (Cloudflare Worker — handled separately)
//
// Endpoints:
//   GET /<channel>/manifest.json               → full signed manifest
//   GET /<channel>/manifest.canonical.json    → canonical JSON body (no sigs)
//   GET /<channel>/electron/latest.yml        → electron-updater sidecar
//   GET /<channel>/capacitor/<bundle>.zip     → Capacitor bundle passthrough
//   GET /<channel>/pwa/<path>                 → PWA assets passthrough
//   GET /<channel>/signatures.json            → just the signatures array
//
// Staged rollout:
//   - electron-updater enforces `stagingPercentage` itself (client-side
//     deterministic hash of device ID). The Worker echoes the value through.
//   - Capacitor Live Update: server-side gating — the Worker compares the
//     request's `X-Capawesome-Device-Id` header against the manifest's
//     `staged_rollout` field. If the device is outside the rollout, the
//     Worker returns 404 (the client falls back to its embedded bundle).
//   - PWA: the service worker activates atomically. The Workbox manifest
//     pre-cache reflects the *full* manifest; rollout is controlled by
//     publishing to a `<channel>/web/...` prefix that the SW selectively
//     fetches.
//
// Deploy:
//   cd apps/airiz-motor/release-relay && wrangler deploy --env production
//
// Required R2 binding: `airiz_releases` (bucket: airiz-releases).
//
// This is a separate Worker from `apps/airiz-motor/relay/` (the existing
// runtime WebRTC/WebSocket relay). Different concerns, different deploy
// cadence, different Worker name on Cloudflare.

interface Env {
  airiz_releases: R2Bucket;
  AIRIZ_SIGNING_PUBLIC_KEYS_PEM?: string; // multi-key support during rotation
  ROLLOUT_HEADER: string; // header for Capacitor device-id
}

interface Manifest {
  schema_version: number;
  app_id: string;
  channel: string;
  released_at: string;
  staged_rollout: number;
  target_versions: Record<string, string>;
  artifacts: Record<string, ArtifactRef>;
  signatures: Array<{ key_id: string; alg: string; value: string }>;
}

interface ArtifactRef {
  url: string;
  sha512?: string;
  sha256?: string;
  size?: number;
  blockmap_url?: string;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/+/, "");
    // Special case FIRST: top-level channel file like `/production.yml`.
    // electron-updater's GenericProvider builds the URL as `<baseUrl>/<channel>.yml`
    // (e.g. `/production.yml`) when channel=production; the destructure below would
    // eat the whole path into `channel`, so handle this before it.
    const channelFileMatch = path.match(/^([^/]+)\.ya?ml$/);
    if (channelFileMatch) {
      const channelName = channelFileMatch[1];
      const channelFile = channelFileMatch[0];
      const manifestObj = await env.airiz_releases.get(`${channelName}/manifest.json`);
      if (!manifestObj) return new Response("manifest not found", { status: 404 });
      const manifest: Manifest = await manifestObj.json();
      if (!(await verifyAny(manifest, env.AIRIZ_SIGNING_PUBLIC_KEYS_PEM))) {
        return new Response("manifest signature invalid", { status: 500 });
      }
      const cached = await env.airiz_releases.get(
        `${channelName}/electron/${channelFile}`,
      );
      if (cached) return yamlFromR2(cached);
      return synthesizeElectronYml(manifest);
    }
    const [channel, ...rest] = path.split("/");

    // Health check.
    if (path === "health") return new Response("ok", { status: 200 });

    // Always-200 manifest probe (used by the surface to detect new releases).
    if (rest[0] === "ping") {
      const obj = await env.airiz_releases.get(`${channel}/manifest.json`);
      return new Response(obj ? "present" : "missing", { status: 200 });
    }

    // Read manifest from R2.
    const manifestObj = await env.airiz_releases.get(`${channel}/manifest.json`);
    if (!manifestObj) return new Response("manifest not found", { status: 404 });
    const manifest: Manifest = await manifestObj.json();

    // Defense-in-depth re-verify on every read.
    if (!(await verifyAny(manifest, env.AIRIZ_SIGNING_PUBLIC_KEYS_PEM))) {
      return new Response("manifest signature invalid", { status: 500 });
    }

    // 1) Full manifest.
    if (rest.length === 1 && rest[0] === "manifest.json") {
      return json(manifest, channel);
    }

    // 2) Canonical JSON body (no signatures).
    if (rest.length === 1 && rest[0] === "manifest.canonical.json") {
      const { signatures, ...body } = manifest;
      return json(body, channel);
    }

    // 3) electron-updater sidecar. We delegate to the build-time tool's
    //    output if it's been cached at <channel>/electron/latest.yml; if not,
    //    the relay generates it on the fly.
    if (rest[0] === "electron" && /\.ya?ml$/.test(rest[1] ?? "")) {
      const cached = await env.airiz_releases.get(
        `${channel}/electron/${rest[1]}`,
      );
      if (cached) return yamlFromR2(cached);
      // Fallback: synthesize latest.yml from the unified manifest.
      return synthesizeElectronYml(manifest);
    }

    // 4) Capacitor bundle passthrough, with server-side rollout gating.
    if (rest[0] === "capacitor") {
      if (!(await withinRollout(req, manifest, env.ROLLOUT_HEADER))) {
        return new Response("not in rollout", { status: 404 });
      }
      const obj = await env.airiz_releases.get(`${channel}/capacitor/${rest.slice(1).join("/")}`);
      if (!obj) return new Response("not found", { status: 404 });
      return passthrough(obj, channel);
    }

    // 5) PWA assets passthrough.
    if (rest[0] === "pwa") {
      const obj = await env.airiz_releases.get(
        `${channel}/pwa/${rest.slice(1).join("/")}`,
      );
      if (!obj) return new Response("not found", { status: 404 });
      return passthrough(obj, channel);
    }

    return new Response("not found", { status: 404 });
  },
};

// ============================================================================
// Verification (subset of tools/sign-manifest.ts)
// ============================================================================

async function verifyAny(
  manifest: Manifest,
  publicKeysPem?: string,
): Promise<boolean> {
  const sigs = manifest.signatures ?? [];
  if (sigs.length === 0) return false;
  // Build canonical body (signatures excluded).
  const { signatures: _omit, ...body } = manifest;
  const canonical = canonicalJson(body);
  const data = new TextEncoder().encode(canonical);

  // Try every public key against every signature.
  const keys = (publicKeysPem ?? "").split(/;;/).filter((k) => k.trim().length > 0);
  if (keys.length === 0) return false;
  for (const pem of keys) {
    for (const sig of sigs) {
      if (sig.alg !== "ed25519") continue;
      try {
        const key = await crypto.subtle.importKey(
          "spki",
          pemToDer(pem),
          { name: "Ed25519" },
          false,
          ["verify"],
        );
        const ok = await crypto.subtle.verify(
          "Ed25519",
          key,
          base64ToBytes(sig.value),
          data,
        );
        if (ok) return true;
      } catch {
        // skip malformed key/sig
      }
    }
  }
  return false;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") +
    "}"
  );
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

// ============================================================================
// Rollout gating (Capacitor side)
// ============================================================================

async function withinRollout(req: Request, manifest: Manifest, header: string): Promise<boolean> {
  // Production = 100% always.
  const pct = manifest.staged_rollout ?? 100;
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  const deviceId = req.headers.get(header) ?? "";
  if (!deviceId) return false;
  // Deterministic SHA-256 → uniform 0–1 bucket. Same device ID, same bucket,
  // same rollout decision across the fleet. Matches electron-updater's
  // `isStagingMatch` (AppUpdater.ts:682-703) which uses
  // `UUID.parse(stagingUserId).readUInt32BE(12) / 0xffffffff` over a
  // different input but the same uniform 0–1 bucketing idea.
  const hashHex = await sha256Hex(deviceId + ":" + manifest.channel);
  const bucket = parseInt(hashHex.slice(0, 8), 16) / 0xffffffff;
  return bucket * 100 < pct;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// Response helpers
// ============================================================================

function json(body: unknown, channel: string): Response {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // 60s cache, 10min stale-while-revalidate. The CI overwrites the
      // object atomically on each release, so SWR handles the read race.
      "cache-control": "public, max-age=60, stale-while-revalidate=600",
      "x-airiz-channel": channel,
    },
  });
}

function yamlFromR2(obj: R2ObjectBody): Response {
  return new Response(obj.body, {
    headers: {
      "content-type": "application/x-yaml; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=600",
      "etag": obj.etag,
    },
  });
}

function passthrough(obj: R2ObjectBody, channel: string): Response {
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      "etag": obj.etag,
      "x-airiz-channel": channel,
    },
  });
}

function synthesizeElectronYml(manifest: Manifest): Response {
  // Minimal latest.yml generator, mirroring the build-time tool.
  const a = manifest.artifacts.electron;
  if (!a?.sha512 || a.size === undefined) {
    return new Response("electron artifact missing sha512/size", { status: 500 });
  }
  const doc = {
    version: manifest.target_versions.electron,
    files: [{ url: a.url, sha512: a.sha512, size: a.size }],
    path: a.url,
    sha512: a.sha512,
    size: a.size,
    releaseDate: manifest.released_at,
    stagingPercentage: manifest.staged_rollout,
    signatures: manifest.signatures.map((s) => ({
      keyId: s.key_id,
      signature: s.value,
    })),
  };
  // Hand-emit YAML for the schema we need (no deps).
  const yaml = toYaml(doc);
  return new Response(yaml + "\n", {
    headers: {
      "content-type": "application/x-yaml; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=600",
      "x-airiz-channel": manifest.channel,
    },
  });
}

function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        const head = `${pad}- `;
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          const entries = Object.entries(item as Record<string, unknown>);
          if (entries.length === 0) return `${head}{}`.trimEnd();
          const [firstKey, firstVal] = entries[0];
          return (
            head +
            `${firstKey}: ${renderScalar(firstVal)}\n` +
            entries
              .slice(1)
              .map(([k, v]) => `${pad}  ${k}: ${renderScalar(v) ?? toYaml(v, indent + 2)}`)
              .join("\n")
          );
        }
        return head + (renderScalar(item) ?? toYaml(item, indent + 2));
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        const rendered = renderScalar(v);
        if (rendered !== null) return `${pad}${k}: ${rendered}`;
        if (Array.isArray(v) && v.length === 0) return `${pad}${k}: []`;
        if (v !== null && typeof v === "object" && Object.keys(v).length === 0)
          return `${pad}${k}: {}`;
        return `${pad}${k}:\n${toYaml(v, indent + 2)}`;
      })
      .join("\n");
  }
  return String(value);
}

function renderScalar(v: unknown): string | null {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  return null;
}
