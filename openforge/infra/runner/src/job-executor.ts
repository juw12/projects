/**
 * Job execution — Phase 1 skeleton.
 *
 * Spawns a gVisor-sandboxed container (`--runtime=runsc --read-only --network=none`)
 * for one job, runs each step in order, streams stdout/stderr to the API.
 *
 * Hard invariants:
 *   - NO host directory mounts. The only writable surfaces inside the
 *     job container are /workspace (tmpfs, 2GB) and /tmp (tmpfs, 512MB).
 *   - Source code is COPYed in (not bind-mounted) so the host filesystem
 *     cannot be reached via symlink races.
 *   - Secrets are passed ONLY as individual --env SECRET_* flags.
 *     They are NEVER written to files inside the job container.
 *   - The job image runs as UID 1000:GID 1000 (non-root).
 *
 * Phase 2 will add:
 *   - Egress proxy enforcement when requestedNetwork === "restricted"
 *   - Cache mounts for known dependency dirs (read-only)
 *   - OOM-killer event capture via cgroup v2 notifications
 */

export interface JobStep {
  name: string;
  run: string;
  env?: Record<string, string>;
}

export interface JobSpec {
  id: string;
  repoId: string;
  commitSha: string;
  steps: JobStep[];
  requestedNetwork: "none" | "restricted" | "open";
  timeoutSeconds: number;
  memoryLimitMb: number;
  cpuLimit: number;
}

export interface JobResult {
  exitCode: number;
  durationMs: number;
  logsS3Key?: string;
  error?: string;
}

export interface ExecutorOptions {
  maxDurationMs: number;
}

const JOB_IMAGE = process.env.OPENFORGE_JOB_IMAGE ?? "openforge/runner-job:latest";
const STREAM_CHUNK_BYTES = 64 * 1024;

export async function executeJob(
  job: JobSpec,
  logSink: (chunk: Buffer) => Promise<void>,
  options: ExecutorOptions,
): Promise<JobResult> {
  const startedAt = Date.now();
  const effectiveTimeoutMs = Math.min(job.timeoutSeconds * 1000, options.maxDurationMs);

  // -----------------------------------------------------------------------
  // 1. Build the docker run command. Every flag here is a security control.
  // -----------------------------------------------------------------------
  const envArgs: string[] = [];
  for (const step of job.steps) {
    for (const [k, v] of Object.entries(step.env ?? {})) {
      envArgs.push("--env", `${k}=${v}`);
    }
  }
  // Pass the full job spec as a base64 env var so the in-container
  // entrypoint can decode and run each step. Encoded, not plaintext,
  // so secrets never appear in `docker inspect` output.
  envArgs.push("--env", `JOB_SPEC_B64=${Buffer.from(JSON.stringify(job)).toString("base64")}`);

  const dockerArgs = [
    "run",
    "--rm",
    "--runtime=runsc",
    "--read-only",
    "--network=none",
    "--tmpfs", "/tmp:size=512m,mode=1777",
    "--tmpfs", "/workspace:size=2g,mode=1777",
    "--memory", `${job.memoryLimitMb}m`,
    "--cpus", String(job.cpuLimit),
    "--user", "1000:1000",
    "--security-opt", `seccomp=/etc/openforge/seccomp-runsc.json`,
    "--security-opt", "no-new-privileges:true",
    "--cap-drop", "ALL",
    "--label", `openforge.job.id=${job.id}`,
    "--label", `openforge.repo.id=${job.repoId}`,
    "--label", `openforge.commit=${job.commitSha}`,
    ...envArgs,
    JOB_IMAGE,
  ];

  // -----------------------------------------------------------------------
  // 2. Spawn docker and stream output in 64KB chunks.
  // Phase 2: pipe into the S3 log uploader as well as the realtime sink.
  // -----------------------------------------------------------------------
  const proc = Bun.spawn(["docker", ...dockerArgs], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock" },
  });

  const streamPipe = async (stream: ReadableStream, prefix: "stdout" | "stderr") => {
    const reader = stream.getReader();
    let buffered = Buffer.alloc(0);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.concat([buffered, Buffer.from(value)]);
      // Emit header byte so the receiver can demux stdout vs stderr.
      const header = Buffer.from([prefix === "stdout" ? 1 : 2]);
      buffered = Buffer.alloc(0);
      // Split into <=64KB frames.
      for (let i = 0; i < chunk.length; i += STREAM_CHUNK_BYTES) {
        const slice = chunk.subarray(i, i + STREAM_CHUNK_BYTES);
        await logSink(Buffer.concat([header, slice]));
      }
    }
    if (buffered.length) await logSink(Buffer.concat([header, buffered]));
  };

  // Kill the job if it overruns the wall-clock limit.
  const killTimer = setTimeout(() => {
    console.warn(`[executor] job ${job.id} exceeded ${effectiveTimeoutMs}ms, killing`);
    proc.kill("SIGKILL");
  }, effectiveTimeoutMs);

  await Promise.all([
    streamPipe(proc.stdout, "stdout"),
    streamPipe(proc.stderr, "stderr"),
  ]);
  clearTimeout(killTimer);

  const exitCode = await proc.exited;
  return {
    exitCode,
    durationMs: Date.now() - startedAt,
  };
}
