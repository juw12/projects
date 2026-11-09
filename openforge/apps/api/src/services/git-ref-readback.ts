/**
 * Read every ref from a bare git repo's actual on-disk state.
 *
 * Used as the post-receive-pack ground truth: after git's subprocess has
 * finished updating refs on disk, this is the source of which SHA every
 * ref now points to. We diff this against the pre-push DB snapshot to
 * figure out which refs need a CAS bump.
 *
 * Spawns `git for-each-ref --format='%(objectname) %(refname)'` rather
 * than reading packed-refs directly because:
 *   1. git handles the packed-refs vs loose-refs fallback transparently.
 *   2. A future phase can swap this for `git for-each-ref --format=%(*objectname)`
 *      if we ever support symbolic refs (we don't yet).
 *   3. Empty repo (zero refs) must not throw — git exits 0 with no output.
 */
import { spawn } from 'node:child_process';
import { gitBinaryPath } from '@openforge/git-transport';

export interface GitRef {
  refName: string;
  sha: string;
}

export async function readRefsFromGit(repoDir: string): Promise<GitRef[]> {
  const args = ['for-each-ref', "--format=%(objectname) %(refname)"];
  const { stdout } = spawnGit(args, repoDir);

  let raw = '';
  for await (const chunk of stdout) {
    raw += chunk.toString('utf8');
  }

  if (raw.length === 0) return [];
  const refs: GitRef[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const space = trimmed.indexOf(' ');
    if (space <= 0) continue;
    const sha = trimmed.slice(0, space);
    const refName = trimmed.slice(space + 1);
    if (sha.length !== 40) continue;
    refs.push({ refName, sha });
  }
  return refs;
}

function spawnGit(
  args: readonly string[],
  repoDir: string,
): { stdout: NodeJS.ReadableStream } {
  const child = spawn(gitBinaryPath(), args, {
    cwd: repoDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!child.stdout) {
    throw new Error('git for-each-ref: failed to acquire stdout pipe');
  }
  child.stderr?.on('data', (chunk: Buffer) => {
    // eslint-disable-next-line no-console
    console.warn(`[git-ref-readback] git for-each-ref stderr: ${chunk.toString('utf8')}`);
  });
  return { stdout: child.stdout };
}
