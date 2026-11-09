/**
 * Demo seed data. Runs once on first launch when the profiles store is empty.
 * Three fake buddies + a few chat messages + a couple of focus history rows,
 * so the UI has something to show immediately.
 */

import { putOne, getAll, delOne } from '@/db/local';
import type { ChatMessage, FocusSession, UserProfile, FriendEdge } from '@shared/types';

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const UUID = () => crypto.randomUUID();
const dayString = (offset: number) => new Date(NOW - offset * DAY).toISOString().slice(0, 10);

const ME_ID = 'me';

const ME_PROFILE: UserProfile = {
  id: ME_ID,
  display_name: 'You',
  avatar_url: null,
  bio: 'Demo user. Working solo for now.',
  current_streak_days: 4,
  longest_streak_days: 12,
  last_streak_date: dayString(0),
  total_focus_seconds: 27_300,
  active_switch_profile: 'cherry-blue',
  active_theme: 'neon',
  last_seen_at: new Date().toISOString(),
  created_at: new Date(NOW - 60 * DAY).toISOString(),
  clicky_count: 7,
  clicky_received_count: 12,
};

const ALEX_ID = 'buddy-alex';
const JORDAN_ID = 'buddy-jordan';
const SAM_ID = 'buddy-sam';

const ALEX: UserProfile = {
  id: ALEX_ID,
  display_name: 'Alex',
  avatar_url: null,
  bio: 'Backend dev. Loves long focus blocks.',
  current_streak_days: 9,
  longest_streak_days: 14,
  last_streak_date: dayString(0),
  total_focus_seconds: 84_200,
  active_switch_profile: 'cherry-brown',
  active_theme: 'neon',
  last_seen_at: new Date(NOW - 5 * MIN).toISOString(),
  created_at: new Date(NOW - 90 * DAY).toISOString(),
  clicky_count: 23,
  clicky_received_count: 41,
};

const JORDAN: UserProfile = {
  id: JORDAN_ID,
  display_name: 'Jordan',
  avatar_url: null,
  bio: 'Designer. Pomodoro enthusiast.',
  current_streak_days: 2,
  longest_streak_days: 8,
  last_streak_date: dayString(1),
  total_focus_seconds: 41_800,
  active_switch_profile: 'topre',
  active_theme: 'synthwave',
  last_seen_at: new Date(NOW - 2 * HOUR).toISOString(),
  created_at: new Date(NOW - 30 * DAY).toISOString(),
  clicky_count: 12,
  clicky_received_count: 18,
};

const SAM: UserProfile = {
  id: SAM_ID,
  display_name: 'Sam',
  avatar_url: null,
  bio: 'Just here for the clickies.',
  current_streak_days: 0,
  longest_streak_days: 3,
  last_streak_date: dayString(4),
  total_focus_seconds: 8_900,
  active_switch_profile: 'buckling-spring',
  active_theme: 'minimal',
  last_seen_at: new Date(NOW - 3 * DAY).toISOString(),
  created_at: new Date(NOW - 14 * DAY).toISOString(),
  clicky_count: 4,
  clicky_received_count: 9,
};

const FRIENDS: FriendEdge[] = [
  { id: UUID(), user_id: ME_ID, friend_id: ALEX_ID, status: 'accepted', invite_code: null, created_at: new Date(NOW - 30 * DAY).toISOString(), accepted_at: new Date(NOW - 29 * DAY).toISOString(), profile: ALEX },
  { id: UUID(), user_id: ME_ID, friend_id: JORDAN_ID, status: 'accepted', invite_code: null, created_at: new Date(NOW - 14 * DAY).toISOString(), accepted_at: new Date(NOW - 13 * DAY).toISOString(), profile: JORDAN },
  { id: UUID(), user_id: ME_ID, friend_id: SAM_ID, status: 'accepted', invite_code: null, created_at: new Date(NOW - 7 * DAY).toISOString(), accepted_at: new Date(NOW - 7 * DAY + HOUR).toISOString(), profile: SAM },
];

function mkMessage(senderId: string, recipientId: string, body: string, minutesAgo: number): ChatMessage {
  const [a, b] = senderId < recipientId ? [senderId, recipientId] : [recipientId, senderId];
  return {
    id: UUID(),
    user_a_id: a,
    user_b_id: b,
    sender_id: senderId,
    body,
    meta: null,
    created_at: new Date(NOW - minutesAgo * MIN).toISOString(),
  };
}

const MESSAGES_ALEX: ChatMessage[] = [
  mkMessage(ALEX_ID, ME_ID, 'morning — starting a 90-min on the auth refactor', 180),
  mkMessage(ME_ID, ALEX_ID, 'nice, gl', 175),
  mkMessage(ALEX_ID, ME_ID, 'ttyl', 5),
];

const MESSAGES_JORDAN: ChatMessage[] = [
  mkMessage(JORDAN_ID, ME_ID, 'how do you deal with context-switching during a focus block?', 90),
  mkMessage(ME_ID, JORDAN_ID, 'try a 25/5 cadence, breaks are non-negotiable for me', 85),
  mkMessage(JORDAN_ID, ME_ID, 'thanks, will try', 80),
];

const SESSIONS: FocusSession[] = [
  { id: UUID(), user_id: ME_ID, planned_seconds: 25 * 60, actual_seconds: 25 * 60, state: 'completed', note: 'Wire up the IPC bridge', started_at: new Date(NOW - 4 * HOUR).toISOString(), ended_at: new Date(NOW - 4 * HOUR + 25 * MIN).toISOString() },
  { id: UUID(), user_id: ME_ID, planned_seconds: 25 * 60, actual_seconds: 23 * 60, state: 'completed', note: 'Read through the renderer hooks', started_at: new Date(NOW - 1 * DAY).toISOString(), ended_at: new Date(NOW - 1 * DAY + 23 * MIN).toISOString() },
  { id: UUID(), user_id: ME_ID, planned_seconds: 25 * 60, actual_seconds: 25 * 60, state: 'completed', note: 'Audio engine tests', started_at: new Date(NOW - 2 * DAY).toISOString(), ended_at: new Date(NOW - 2 * DAY + 25 * MIN).toISOString() },
  { id: UUID(), user_id: ME_ID, planned_seconds: 25 * 60, actual_seconds: 25 * 60, state: 'completed', note: 'Schema design', started_at: new Date(NOW - 3 * DAY).toISOString(), ended_at: new Date(NOW - 3 * DAY + 25 * MIN).toISOString() },
];

export async function seedIfEmpty(): Promise<void> {
  for (const store of ['profiles', 'friends', 'messages', 'focus_sessions', 'streak_days', 'clicky_events'] as const) {
    const rows = await getAll(store);
    for (const row of rows) {
      if (row.id) await delOne(store, row.id);
    }
  }

  await putOne('profiles', ME_PROFILE);
  await putOne('profiles', ALEX);
  await putOne('profiles', JORDAN);
  await putOne('profiles', SAM);

  for (const f of FRIENDS) {
    await putOne('friends', f);
  }

  for (const m of [...MESSAGES_ALEX, ...MESSAGES_JORDAN]) {
    await putOne('messages', m);
  }

  for (const s of SESSIONS) {
    await putOne('focus_sessions', s);
  }

  for (const [userId, days] of [
    [ME_ID, 4],
    [ALEX_ID, 9],
    [JORDAN_ID, 2],
  ] as Array<[string, number]>) {
    for (let i = 0; i < days; i++) {
      await putOne('streak_days', {
        id: `${userId}-${dayString(i)}`,
        user_id: userId,
        day: dayString(i),
        completed: true,
        focus_seconds: 25 * 60 + Math.floor(Math.random() * 10 * 60),
      });
    }
  }

  for (const recipientId of [ALEX_ID, JORDAN_ID, SAM_ID]) {
    await putOne('clicky_events', {
      id: UUID(),
      from_user_id: ME_ID,
      to_user_id: recipientId,
      source: 'manual',
      created_at: new Date(NOW - 6 * HOUR).toISOString(),
    });
  }
}
