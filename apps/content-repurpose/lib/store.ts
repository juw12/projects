import { promises as fs } from "fs";
import path from "path";

const STORE_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "users.json");

export type Tier = "free" | "pro" | "power";

export interface UserRecord {
  tier: Tier;
  expiresAt: number; // unix ms; 0 = no expiry (free)
  uses: number;
  resetAt: number;
}

async function readAll(): Promise<Record<string, UserRecord>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, UserRecord>;
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, UserRecord>): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));
}

export async function getUserRecord(userId: string): Promise<UserRecord | null> {
  const all = await readAll();
  return all[userId] ?? null;
}

export async function setUserRecord(userId: string, record: UserRecord): Promise<void> {
  const all = await readAll();
  all[userId] = record;
  await writeAll(all);
}

export async function setUserTier(
  userId: string,
  tier: Exclude<Tier, "free">,
  durationMs = 30 * 24 * 60 * 60 * 1000
): Promise<void> {
  const existing = (await getUserRecord(userId)) ?? {
    tier: "free",
    expiresAt: 0,
    uses: 0,
    resetAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  await setUserRecord(userId, {
    ...existing,
    tier,
    expiresAt: Date.now() + durationMs,
    uses: 0,
    resetAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
}

export async function clearUserTier(userId: string): Promise<void> {
  const existing = await getUserRecord(userId);
  if (!existing) return;
  await setUserRecord(userId, {
    ...existing,
    tier: "free",
    expiresAt: 0,
  });
}
