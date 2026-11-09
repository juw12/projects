import { promises as fs } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.env['REPO_ROOT'] ?? '/var/lib/openforge/repos';

const NAME_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Compute the bare repo path WITHOUT checking existence on disk.
 *
 * Used both when creating a new repo (caller verifies the path does not yet
 * exist) and when computing the destination for a fork. Throws if `owner`
 * or `repo` would yield a path component outside the allowed character set
 * — this is the single guard rail that stops a malicious caller from
 * escaping the REPO_ROOT via `..` or `/`.
 */
export function bareRepoPathFor(owner: string, repo: string): string {
  if (!NAME_RE.test(owner) || owner.length < 1 || owner.length > 100) {
    throw new Error(`invalid owner name: ${JSON.stringify(owner)}`);
  }
  if (!NAME_RE.test(repo) || repo.length < 1 || repo.length > 100) {
    throw new Error(`invalid repo name: ${JSON.stringify(repo)}`);
  }
  return path.join(REPO_ROOT, owner, `${repo}.git`);
}

/**
 * Resolve the bare repo path ONLY if the directory exists on disk.
 *
 * Used by the smart-HTTP layer to confirm the repo is real before serving
 * refs / packfile negotiation. Returns null for both "no such dir" and
 * "exists but is a file" — the caller treats both as "not served".
 */
export async function resolveBareRepoPath(
  owner: string,
  repo: string,
): Promise<string | null> {
  let candidate: string;
  try {
    candidate = bareRepoPathFor(owner, repo);
  } catch {
    return null;
  }
  try {
    const stat = await fs.stat(candidate);
    return stat.isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}
