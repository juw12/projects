import { supabase, CURRENT_USER_ID_VALUE } from '@/db/local';
import type { LeaderboardEntry } from '@shared/types';

export async function getWeeklyLeaderboard(friendsOnly = true): Promise<LeaderboardEntry[]> {
  const userId = CURRENT_USER_ID_VALUE;

  const profilesResult = await supabase.from('profiles').select();
  const allProfiles = (profilesResult.data ?? []) as Array<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    total_focus_seconds: number;
    current_streak_days: number;
    clicky_received_count: number;
  }>;

  const streakResult = await supabase.from('streak_days').select();
  const allStreakDays = (streakResult.data ?? []) as Array<{ user_id: string; day: string; focus_seconds: number }>;

  const cutoffDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    cutoffDays.push(d.toISOString().slice(0, 10));
  }

  const entries: LeaderboardEntry[] = allProfiles.map((p) => ({
    user_id: p.id,
    display_name: p.display_name,
    avatar_url: p.avatar_url,
    week_focus_seconds: allStreakDays
      .filter((s) => s.user_id === p.id && cutoffDays.includes(s.day))
      .reduce((sum, s) => sum + (s.focus_seconds ?? 0), 0),
    days_completed: allStreakDays.filter((s) => s.user_id === p.id && cutoffDays.includes(s.day)).length,
    current_streak_days: p.current_streak_days ?? 0,
    clicky_received_count: p.clicky_received_count ?? 0,
  }));

  entries.sort((a, b) => b.week_focus_seconds - a.week_focus_seconds);

  if (!friendsOnly) return entries;

  const friendResult = await supabase
    .from('friends')
    .eq('status', 'accepted')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
    .select();
  const friendRows = (friendResult.data ?? []) as Array<{ user_id: string; friend_id: string }>;

  const friendIds = new Set<string>([userId]);
  for (const r of friendRows) {
    friendIds.add(r.user_id);
    friendIds.add(r.friend_id);
  }

  return entries.filter((e) => friendIds.has(e.user_id));
}
