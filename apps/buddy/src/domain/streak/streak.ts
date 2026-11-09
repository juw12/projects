/**
 * Streak tracking: read current streak and recent history.
 */

import { supabase } from '@/db/local';

export async function getMyStreak(): Promise<{
  current: number;
  longest: number;
  lastDate: string | null;
}> {
  const me = (await supabase.auth.getUser()) as { data: { user: { id: string } } };
  const userId = me.data.user.id;
  const result = await supabase
    .from('profiles')
    .eq('id', userId)
    .select();
  const row = result.data[0] as {
    current_streak_days?: number;
    longest_streak_days?: number;
    last_streak_date?: string | null;
  } | undefined;

  return {
    current: row?.current_streak_days ?? 0,
    longest: row?.longest_streak_days ?? 0,
    lastDate: row?.last_streak_date ?? null,
  };
}

export async function getStreakHistory(days = 7): Promise<Array<{ day: string; focus_seconds: number }>> {
  const me = (await supabase.auth.getUser()) as { data: { user: { id: string } } };
  const userId = me.data.user.id;
  const r = await supabase
    .from('streak_days')
    .eq('user_id', userId)
    .order('day', { ascending: false })
    .limit(days)
    .select();
  return (r.data ?? []) as Array<{ day: string; focus_seconds: number }>;
}
