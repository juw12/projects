/**
 * OS-level keyboard hook subprocess manager.
 *
 * Spawns a platform-specific helper process that captures global keyboard
 * events and forwards them as JSON to stdout. We use a subprocess rather
 * than a native Node addon so we don't need MSVC build tools on Windows
 * — the helper uses PowerShell + .NET on Windows, Swift on macOS,
 * and Python on Linux.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { KeyboardEvent } from '../../shared/types.js';

export interface HookHandle {
  /** Stop the subprocess and release resources. */
  stop(): Promise<void>;
}

export interface SpawnOptions {
  scriptPath: string;
  onEvent: (event: KeyboardEvent) => void;
  onError: (err: Error) => void;
  onExit: (code: number | null) => void;
}

export function spawnHook(opts: SpawnOptions): HookHandle {
  if (process.platform === 'win32') {
    return spawnWindows(opts);
  }
  if (process.platform === 'darwin') {
    return spawnMacOS(opts);
  }
  return spawnLinux(opts);
}

// -------- Windows: PowerShell + .NET SetWindowsHookEx --------

function spawnWindows(opts: SpawnOptions): HookHandle {
  if (!existsSync(opts.scriptPath)) {
    queueMicrotask(() => {
      opts.onError(new Error(`Hook script not found: ${opts.scriptPath}`));
    });
    return { stop: async () => {} };
  }

  // -NoProfile skips profile scripts; -ExecutionPolicy Bypass avoids policy blocks.
  const child: ChildProcess = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', opts.scriptPath,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );

  let buffer = '';

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length === 0) { nl = buffer.indexOf('\n'); continue; }
      try {
        const event = JSON.parse(line) as KeyboardEvent;
        opts.onEvent(event);
      } catch (err) {
        opts.onError(new Error(`Bad hook JSON: ${line}`));
      }
      nl = buffer.indexOf('\n');
    }
  });

  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 4096) stderr = stderr.slice(-4096);
  });

  child.on('error', (err) => opts.onError(err));
  child.on('exit', (code) => {
    if (stderr.trim()) {
      opts.onError(new Error(`Hook stderr: ${stderr.trim()}`));
    }
    opts.onExit(code);
  });

  return {
    stop: async () => {
      // PowerShell side listens for "QUIT\n" on stdin; fall back to kill.
      try {
        child.stdin?.write('QUIT\n');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill();
            resolve();
          }, 500);
          child.on('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      } catch {
        child.kill();
      }
    },
  };
}

// -------- macOS: stub for v1 (full impl needs Accessibility entitlement) --------

function spawnMacOS(_opts: SpawnOptions): HookHandle {
  // macOS needs CGEventTapCreate and Accessibility permission for the
  // parent process. Without the entitlement, the tap is silently disabled.
  // For v1 we surface a clear error in the UI so users know what to do.
  // Implementation lives in scripts/keyboard-hook.swift (TODO).
  return {
    stop: async () => {},
  };
}

// -------- Linux: stub for v1 (full impl needs X11 / evdev) --------

function spawnLinux(_opts: SpawnOptions): HookHandle {
  // Linux needs XRecordExtension (X11) or /dev/input/event* (root).
  // Implementation lives in scripts/keyboard-hook.py (TODO).
  return {
    stop: async () => {},
  };
}
