import { cookies } from "next/headers";
import { getUserRecord, setUserRecord, type Tier, type UserRecord } from "@/lib/store";

const COOKIE_NAME = "atomize_user";
const FREE_LIMIT = Number(process.env.FREE_TIER_LIMIT ?? 3);

function newId(): string {
  return crypto.randomUUID();
}

function oneMonthFromNow(): number {
  return Date.now() + 30 * 24 * 60 * 60 * 1000;
}

function defaultRecord(): UserRecord {
  return {
    tier: "free",
    expiresAt: 0,
    uses: 0,
    resetAt: oneMonthFromNow(),
  };
}

export async function getOrCreateUserId(): Promise<string> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (raw) {
    try {
      const decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf-8")) as {
        id: string;
      };
      if (decoded.id) return decoded.id;
    } catch {
      // fall through
    }
  }
  const id = newId();
  store.set(
    COOKIE_NAME,
    Buffer.from(JSON.stringify({ id })).toString("base64"),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    }
  );
  return id;
}

export async function getCurrentUser(): Promise<{ id: string; record: UserRecord }> {
  const id = await getOrCreateUserId();
  const record = (await getUserRecord(id)) ?? defaultRecord();
  if (record.tier === "free" && Date.now() > record.resetAt) {
    const refreshed = { ...record, uses: 0, resetAt: oneMonthFromNow() };
    await setUserRecord(id, refreshed);
    return { id, record: refreshed };
  }
  return { id, record };
}

export async function canUse(): Promise<{ allowed: boolean; remaining: number; tier: Tier }> {
  const { record } = await getCurrentUser();
  if (record.tier === "pro" || record.tier === "power") {
    const active = record.expiresAt === 0 || record.expiresAt > Date.now();
    if (active) {
      return { allowed: true, remaining: Infinity, tier: record.tier };
    }
  }
  const remaining = Math.max(0, FREE_LIMIT - record.uses);
  return {
    allowed: remaining > 0,
    remaining,
    tier: "free",
  };
}

export async function recordUse(): Promise<void> {
  const { id, record } = await getCurrentUser();
  if (record.tier === "free") {
    await setUserRecord(id, { ...record, uses: record.uses + 1 });
  }
}

export async function getUsageSummary(): Promise<{
  tier: Tier;
  uses: number;
  limit: number | null;
  resetAt: number;
}> {
  const { record } = await getCurrentUser();
  return {
    tier: record.tier,
    uses: record.uses,
    limit: record.tier === "free" ? FREE_LIMIT : null,
    resetAt: record.resetAt,
  };
}
