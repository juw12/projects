/**
 * Focus session management: start, complete, abort Pomodoros.
 * Every state change writes a row to focus_events so buddies see real-time
 * notifications. Auto-fires a 'focus_complete' clicky on every buddy when
 * the user completes a session.
 */

import { supabase, CURRENT_USER_ID_VALUE } from '@/db/local';
import { giveClicky } from '@/domain/clicky';
import type { FocusSession, UUID } from '@shared/types';

function getUserId(): string {
  const result = supabase.auth.getUser() as unknown as { data: { user: { id: string } } };
  return result.data.user.id ?? CURRENT_USER_ID_VALUE;
}

export async function startFocusSession(
  plannedSeconds: number,
  note?: string,
): Promise<FocusSession> {
  const userId = getUserId();

  await supabase
    .from('focus_sessions')
    .update({ state: 'aborted', ended_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('state', 'active')
    .select();

  const result = await supabase
    .from('focus_sessions')
    .insert({
      user_id: userId,
      planned_seconds: plannedSeconds,
      state: 'active',
      note: note ?? null,
    })
    .select();
  const session = result.data[0];
  if (!session) throw new Error('Failed to insert focus session');

  await supabase.from('focus_events').insert({
    user_id: userId,
    kind: 'start',
    session_id: session.id,
    planned_seconds: plannedSeconds,
    note: note ?? null,
  });

  return session as FocusSession;
}

export async function completeFocusSession(sessionId: UUID, actualSeconds: number): Promise<void> {
  const userId = getUserId();

  await supabase
    .from('focus_sessions')
    .update({
      state: 'completed',
      actual_seconds: actualSeconds,
      ended_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .select();

  await supabase.from('focus_events').insert({
    user_id: userId,
    kind: 'complete',
    session_id: sessionId,
    planned_seconds: actualSeconds,
  });

  await updateStreakDay(userId, actualSeconds);
  await autoClickyBuddies(userId);
}

export async function abortFocusSession(sessionId: UUID): Promise<void> {
  const userId = getUserId();

  await supabase
    .from('focus_sessions')
    .update({ state: 'aborted', ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select();

  await supabase.from('focus_events').insert({
    user_id: userId,
    kind: 'abort',
    session_id: sessionId,
  });
}

export async function getActiveSession(): Promise<FocusSession | null> {
  const userId = getUserId();
  const result = await supabase
    .from('focus_sessions')
    .eq('user_id', userId)
    .eq('state', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .select();
  return (result.data[0] ?? null) as FocusSession | null;
}

async function updateStreakDay(userId: UUID, seconds: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await supabase
    .from('streak_days')
    .eq('user_id', userId)
    .eq('day', today)
    .select();
  const existingRow = existing.data[0] as { focus_seconds?: number } | undefined;

  const next = {
    id: `${userId}-${today}`,
    user_id: userId,
    day: today,
    completed: true,
    focus_seconds: (existingRow?.focus_seconds ?? 0) + seconds,
  };
  await supabase.from('streak_days').insert(next).select();
}

async function autoClickyBuddies(userId: UUID): Promise<void> {
  const result = await supabase
    .from('friends')
    .eq('status', 'accepted')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
    .select();

  const buddyIds = ((result.data ?? []) as Array<{ user_id: string; friend_id: string }>)
    .map((r) => (r.user_id === userId ? r.friend_id : r.user_id));

  await Promise.all(
    buddyIds.map((id) =>
      giveClicky(id, 'focus_complete').catch((err) => {
        console.warn('[focus] auto-clicky failed:', err);
      }),
    ),
  );
}
