/**
 * OpenForge CI runner daemon.
 *
 * Lifecycle:
 *   register()    → POST /api/runners/register with bootstrap token
 *   heartbeat()   → every 30s, POST /api/runners/{id}/heartbeat (rotates token)
 *   pickupJob()   → long-poll GET /api/runners/{id}/jobs/next
 *   executeJob()  → spawn gVisor-sandboxed container, stream logs
 *
 * Phase 1 status: skeleton. Phase 2 will fill in:
 *   - Redis pub/sub for low-latency job dispatch (currently HTTP long-poll)
 *   - BullMQ producer/consumer for job lifecycle events
 *   - Per-job resource accounting + OOM reporting
 *   - Egress proxy for jobs that request restricted network access
 */
import { jobExecutor, type JobSpec, type JobResult } from "./job-executor.ts";

interface RunnerConfig {
  apiUrl: string;
  bootstrapToken: string;
  name: string;
  labels: string[];
  concurrency: number;
  heartbeatIntervalMs: number;
}

interface Registration {
  id: string;
  token: string;
  tokenExpiresAt: string;
}

interface JobPickupResponse {
  job: JobSpec | null;
  pollAfterMs: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_JOB_RUNTIME_MS = 6 * 60 * 60 * 1000; // 6h hard cap

export class Runner {
  private config: RunnerConfig;
  private registration: Registration | null = null;
  private inFlight = new Set<Promise<JobResult>>();
  private stopped = false;

  constructor(config: Partial<RunnerConfig> & Pick<RunnerConfig, "apiUrl" | "bootstrapToken">) {
    this.config = {
      name: "runner-local",
      labels: ["linux", "x64", "gvisor"],
      concurrency: 2,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      ...config,
    };
  }

  async start(): Promise<void> {
    console.log(`[runner] starting name=${this.config.name} labels=${this.config.labels.join(",")}`);
    await this.register();
    this.heartbeatLoop();
    this.dispatchLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    console.log(`[runner] stop requested, waiting for ${this.inFlight.size} in-flight job(s)`);
    await Promise.allSettled(this.inFlight);
  }

  // -------------------------------------------------------------------------
  // register() — exchange bootstrap token for a short-lived runner token.
  // The bootstrap token lives in env; the rotated token is in-memory only.
  // -------------------------------------------------------------------------
  private async register(): Promise<void> {
    const res = await fetch(`${this.config.apiUrl}/api/runners/register`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.bootstrapToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: this.config.name,
        labels: this.config.labels,
        version: "0.1.0",
      }),
    });
    if (!res.ok) {
      throw new Error(`register failed: ${res.status} ${await res.text()}`);
    }
    this.registration = await res.json() as Registration;
    console.log(`[runner] registered id=${this.registration.id} tokenExpiresAt=${this.registration.tokenExpiresAt}`);
  }

  // -------------------------------------------------------------------------
  // heartbeat() — every 30s, also receives a fresh rotated token.
  // Failures here are non-fatal (transient network); we back off and retry.
  // -------------------------------------------------------------------------
  private heartbeatLoop(): void {
    const tick = async () => {
      if (this.stopped || !this.registration) return;
      try {
        const res = await fetch(`${this.config.apiUrl}/api/runners/${this.registration.id}/heartbeat`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${this.registration.token}` },
        });
        if (res.ok) {
          const next = await res.json() as Registration;
          this.registration = next;
        } else if (res.status === 401) {
          console.warn("[runner] token expired mid-flight, re-registering");
          await this.register();
        } else {
          console.warn(`[runner] heartbeat ${res.status}`);
        }
      } catch (e) {
        console.warn(`[runner] heartbeat error: ${(e as Error).message}`);
      } finally {
        if (!this.stopped) setTimeout(tick, this.config.heartbeatIntervalMs);
      }
    };
    setTimeout(tick, this.config.heartbeatIntervalMs);
  }

  // -------------------------------------------------------------------------
  // dispatchLoop() — long-poll for jobs, respect concurrency limit.
  // Each pickup returns pollAfterMs so the API can rate-limit idle runners.
  // -------------------------------------------------------------------------
  private async dispatchLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        if (this.inFlight.size >= this.config.concurrency) {
          await Promise.race(this.inFlight);
          continue;
        }
        const next = await this.pickupJob();
        if (next?.job) {
          const promise = this.executeJob(next.job).finally(() => this.inFlight.delete(promise));
          this.inFlight.add(promise);
        } else {
          await new Promise((r) => setTimeout(r, next?.pollAfterMs ?? 2000));
        }
      } catch (e) {
        console.error(`[runner] dispatch error: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async pickupJob(): Promise<JobPickupResponse | null> {
    if (!this.registration) return null;
    const res = await fetch(`${this.config.apiUrl}/api/runners/${this.registration.id}/jobs/next`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.registration.token}` },
      signal: AbortSignal.timeout(35_000),
    });
    if (!res.ok) {
      console.warn(`[runner] pickup failed: ${res.status}`);
      return null;
    }
    return res.json() as Promise<JobPickupResponse>;
  }

  // -------------------------------------------------------------------------
  // executeJob() — orchestrate a single job end-to-end.
  // - Verify the API-attached requestToken (defense against bogus job specs)
  // - Hand off to jobExecutor for sandbox launch + log streaming
  // - POST final status back to the API
  // -------------------------------------------------------------------------
  private async executeJob(job: JobSpec): Promise<JobResult> {
    if (!this.registration) throw new Error("not registered");
    console.log(`[runner] job ${job.id} starting repo=${job.repoId} commit=${job.commitSha.slice(0, 7)}`);

    const logSink = async (chunk: Buffer) => {
      await fetch(`${this.config.apiUrl}/api/runs/${job.id}/logs`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.registration!.token}`,
          "Content-Type": "application/octet-stream",
        },
        body: chunk,
      }).catch(() => {/* drop; the run is over anyway */});
    };

    try {
      const result = await jobExecutor(job, logSink, { maxDurationMs: MAX_JOB_RUNTIME_MS });
      await this.postStatus(job.id, result.exitCode === 0 ? "success" : "failure", result);
      return result;
    } catch (e) {
      const message = (e as Error).message;
      await this.postStatus(job.id, "failure", { exitCode: -1, durationMs: 0, error: message });
      throw e;
    }
  }

  private async postStatus(jobId: string, status: "success" | "failure", body: unknown): Promise<void> {
    if (!this.registration) return;
    await fetch(`${this.config.apiUrl}/api/runs/${jobId}/status`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.registration.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status, ...body as object }),
    });
  }
}

// ---------------------------------------------------------------------------
// Bootstrap (executed by entrypoint.sh via `bun run src/runner.ts`)
// ---------------------------------------------------------------------------
const config: Partial<RunnerConfig> & Pick<RunnerConfig, "apiUrl" | "bootstrapToken"> = {
  apiUrl: process.env.OPENFORGE_API_URL ?? "http://api:8787",
  bootstrapToken: process.env.RUNNER_TOKEN ?? "",
  name: process.env.RUNNER_NAME ?? "runner-local",
  labels: (process.env.RUNNER_LABELS ?? "linux,x64,gvisor").split(",").map((s) => s.trim()),
  concurrency: Number(process.env.RUNNER_CONCURRENCY ?? "2"),
};

const runner = new Runner(config);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[runner] caught ${sig}`);
    runner.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}

runner.start().catch((e) => {
  console.error(`[runner] fatal: ${(e as Error).message}`);
  process.exit(1);
});
