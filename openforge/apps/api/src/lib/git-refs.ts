/**
 * Helpers for reading refs from a bare repo on disk and parsing git's
 * post-receive status report.
 *
 * The bare repo on disk is git's source of truth for ref storage; the
 * Postgres `refs` table mirrors it after every successful push via the
 * CAS update path. These helpers let the API reach into the bare repo
 * when git's status report is ambiguous (e.g. verifying consistency
 * after a CAS failure).
 *
 * git's storage model for refs (per `git pack-refs` / Documentation/git-
 * format-pack.txt):
 *
 *   - Loose refs:    `<bare>/refs/heads/<name>`, `<bare>/refs/tags/<name>`
 *                    etc. Each file contains a 40-byte SHA + LF. One
 *                    ref per file. Looked up first.
 *   - Packed refs:   `<bare>/packed-refs` — a single text file with
 *                    `<sha> <refname>\n` lines, optional `# comment`
 *                    lines, and `^<sha>` lines for peeled annotated
 *                    tags (the SHA of the underlying commit after
 *                    peeling the tag chain). Looked up second; loose
 *                    refs win when both exist.
 *
 * Reference: https://github.com/go-gitea/gitea/blob/main/modules/git/
 *   repo_ref.go (parsePackedRefs), and git.git refs/packed-backend.c.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Walk both loose refs and packed-refs in `barePath` and return a Map
 * of refname → sha. Loose refs override packed-refs for the same
 * refname (this matches git's own resolution order).
 *
 * Skips:
 *   - Lines starting with `#` in packed-refs (comments)
 *   - Lines starting with `^` (peeled-tag SHAs; we return the tag
 *     object SHA, the peeled commit SHA is recoverable on demand)
 *   - Lines with malformed SHA or refname
 *   - Hidden / non-refs/* paths (HEAD, FETCH_HEAD, ORIG_HEAD, …)
 */
export async function readBareRepoRefs(barePath: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  // 1. Packed refs — read first so loose refs win.
  const packedPath = path.join(barePath, 'packed-refs');
  try {
    const packed = await fs.readFile(packedPath, 'utf8');
    for (const line of packed.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('^')) continue; // peeled-tag SHA, handled on demand
      const sp = trimmed.indexOf(' ');
      if (sp < 0) continue;
      const sha = trimmed.slice(0, sp);
      const refName = trimmed.slice(sp + 1);
      if (!isSha(sha)) continue;
      if (!isValidRefName(refName)) continue;
      out.set(refName, sha);
    }
  } catch (e) {
    // packed-refs is optional; missing file is normal for small repos.
    if (!isNotFound(e)) throw e;
  }

  // 2. Loose refs — recursively walk refs/ and override packed entries.
  const refsRoot = path.join(barePath, 'refs');
  await walkLooseRefs(refsRoot, refsRoot, out);

  return out;
}

async function walkLooseRefs(
  root: string,
  dir: string,
  out: Map<string, string>,
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (isNotFound(e)) return; // refs/ may not exist yet
    throw e;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkLooseRefs(root, full, out);
    } else if (entry.isFile()) {
      const rel = path.relative(root, full).split(path.sep).join('/');
      const refName = `refs/${rel}`;
      try {
        const contents = await fs.readFile(full, 'utf8');
        const sha = contents.trim();
        if (isSha(sha) && isValidRefName(refName)) {
          out.set(refName, sha);
        }
      } catch {
        // ignore individual file read errors
      }
    }
  }
}

/**
 * Parse git's post-receive status report (the body of the receive-pack
 * response when `report-status` capability is advertised) into the
 * per-ref change lines we need to CAS the refs table.
 *
 * The status report is a pkt-line stream with lines like:
 *
 *   unpack ok\n
 *   <old-sha> <new-sha> <refname>\n     (one per changed ref)
 *   ok <refname>\n                      (per-ref success)
 *   ng <refname> <reason>\n             (per-ref failure, if any)
 *   0000                                (flush packet)
 *
 * Status reports come in two flavors:
 *
 *   - Pre-image: from `git-receive-pack --report-status` BEFORE the
 *     refs are written. Each ref line is `<old> <new> <refname>`. We
 *     use this to learn what the user requested.
 *
 *   - Post-image: from `git-receive-pack --status-report` AFTER the
 *     refs are written. Same line shape.
 *
 * Lines can be wrapped in pkt-line framing (4 hex ASCII bytes +
 * payload + LF). parseRefUpdateLines strips the framing if present.
 */
export function parseRefUpdateLines(
  statusOutput: string,
): { oldSha: string; newSha: string; refName: string }[] {
  const out: { oldSha: string; newSha: string; refName: string }[] = [];

  for (const rawLine of statusOutput.split('\n')) {
    const line = stripPktLine(rawLine);
    if (line.length === 0) continue;
    if (line.startsWith('unpack ')) continue;
    if (line.startsWith('ok ')) continue;
    if (line.startsWith('ng ')) continue;
    if (line === '0000' || line === '0001') continue;

    const match = line.match(/^([0-9a-f]{40})\s+([0-9a-f]{40})\s+(\S+)$/);
    if (!match) continue;
    const [, oldSha, newSha, refName] = match;
    if (!oldSha || !newSha || !refName) continue;
    out.push({ oldSha, newSha, refName });
  }

  return out;
}

/** Strip the 4-hex-byte pkt-line length prefix if present. */
function stripPktLine(line: string): string {
  if (line.length < 4) return line;
  const head = line.slice(0, 4);
  if (!/^[0-9a-f]{4}$/.test(head)) return line;
  const declared = parseInt(head, 16);
  // declared length includes the 4-byte prefix itself.
  if (declared < 4) return line;
  const payloadLen = declared - 4;
  // The line might already have been split at LF by `split('\n')`,
  // so the remaining content can be shorter than declared.
  return line.slice(4, 4 + payloadLen);
}

function isSha(s: string): boolean {
  return /^[0-9a-f]{40}$/.test(s);
}

/**
 * Ref names are restricted to a subset of paths — see
 * https://git-scm.com/docs/git-check-ref-format. We enforce the basics:
 *  - Must start with `refs/` and have at least one segment.
 *  - No `..`, no `~`, no `^`, no `:`, no `?`, no `*`, no `[`.
 *  - No `@{{` (no reflog selectors).
 *  - No trailing slash, no consecutive slashes.
 *  - No control characters.
 */
function isValidRefName(name: string): boolean {
  if (!name.startsWith('refs/')) return false;
  if (name.length > 1024) return false;
  if (
    name.includes('..') ||
    name.includes('~') ||
    name.includes('^') ||
    name.includes(':') ||
    name.includes('?') ||
    name.includes('*') ||
    name.includes('[') ||
    name.includes('@{')
  ) {
    return false;
  }
  if (name.endsWith('/')) return false;
  if (name.includes('//')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) return false;
  return true;
}

function isNotFound(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: unknown }).code === 'ENOENT'
  );
}
