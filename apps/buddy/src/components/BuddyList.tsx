/**
 * Buddy list — left column on the main view.
 * Shows each accepted friend with their current focus state, today's minutes,
 * and a "chat" button.
 */

import { useEffect } from 'react';
import { useBuddyStore } from '@/state/store';
import { listFriends } from '@/domain/friends/friends';
import { subscribeToFocusEvents } from '@/realtime/subscriptions';
import { giveManualClicky } from '@/domain/clicky';
import { audioEngine } from '@/audio/engine';
import { getProfile } from '@/audio/profiles';
import type { FocusEvent } from '@shared/types';

export function BuddyList(): JSX.Element {
  const buddies = useBuddyStore((s) => s.buddies);
  const setBuddies = useBuddyStore((s) => s.setBuddies);
  const openChat = useBuddyStore((s) => s.openChat);
  const activeBuddyId = useBuddyStore((s) => s.chat.activeBuddyId);
  const setActiveFocus = useBuddyStore((s) => s.setActiveFocus);

  useEffect(() => {
    void listFriends().then(setBuddies).catch(console.error);
  }, [setBuddies]);

  useEffect(() => {
    const unsubs = buddies.map((b) => {
      const otherId = b.user_id === b.friend_id ? null : b.friend_id;
      if (!otherId) return () => {};
      return subscribeToFocusEvents(otherId, (event: FocusEvent) => {
        if (event.kind === 'start') {
          setActiveFocus({
            id: event.session_id ?? '',
            user_id: otherId,
            planned_seconds: event.planned_seconds ?? 25 * 60,
            actual_seconds: 0,
            state: 'active',
            note: event.note,
            started_at: event.created_at,
            ended_at: null,
          });
        } else if (event.kind === 'complete' || event.kind === 'abort') {
          setActiveFocus(null);
        }
      });
    });
    return () => unsubs.forEach((u) => u());
  }, [buddies, setActiveFocus]);

  async function onManualClicky(toUserId: string): Promise<void> {
    try {
      await giveManualClicky(toUserId);
      audioEngine.trigger(getProfile('cherry-blue'), performance.now(), false);
      setBuddies(
        buddies.map((b) =>
          b.friend_id === toUserId || b.user_id === toUserId
            ? {
                ...b,
                profile: b.profile
                  ? { ...b.profile, clicky_received_count: (b.profile.clicky_received_count ?? 0) + 1 }
                  : b.profile,
              }
            : b,
        ),
      );
    } catch (err) {
      console.error('[clicky] manual failed:', err);
    }
  }

  if (buddies.length === 0) {
    return (
      <div className="buddy-list empty">
        <p className="muted">No buddies yet.</p>
        <p className="hint">Pair with a friend to start a focus session together.</p>
      </div>
    );
  }

  return (
    <div className="buddy-list">
      {buddies.map((b) => {
        const profile = b.profile;
        const otherId = profile?.id ?? b.friend_id;
        const isActive = activeBuddyId === otherId;
        return (
          <div
            key={otherId}
            className={`buddy-card ${isActive ? 'is-active' : ''}`}
          >
            <button
              className="buddy-main"
              onClick={() => openChat(otherId)}
            >
              <div className="buddy-avatar">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" />
                ) : (
                  <span>{profile?.display_name?.slice(0, 2).toUpperCase() ?? '?'}</span>
                )}
              </div>
              <div className="buddy-info">
                <div className="buddy-name">{profile?.display_name ?? 'Unknown'}</div>
                <div className="buddy-streak">
                  {profile?.current_streak_days ?? 0}d streak
                </div>
              </div>
            </button>
            <button
              className="clicky-btn"
              onClick={() => void onManualClicky(otherId)}
              title="Send a clicky"
            >
              <span className="clicky-icon">●</span>
              <span className="clicky-count">
                {profile?.clicky_received_count ?? 0}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
