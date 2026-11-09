/**
 * In-process subscriptions. Replaces Supabase Realtime — when everything
 * is local, we just listen to IndexedDB change events.
 */

import { onChange } from '@/db/local';
import type { ChatMessage, FocusEvent, UUID } from '@shared/types';

type Unsubscribe = () => void;

export function subscribeToFocusEvents(
  buddyId: UUID,
  onEvent: (event: FocusEvent) => void,
): Unsubscribe {
  const handler = (event: { store: string; row?: Record<string, unknown> }) => {
    if (event.store !== 'focus_events') return;
    if (!event.row || event.row.user_id !== buddyId) return;
    onEvent(event.row as unknown as FocusEvent);
  };
  return onChange(handler);
}

export function subscribeToChat(
  otherUserId: UUID,
  onMessage: (msg: ChatMessage) => void,
): Unsubscribe {
  const handler = (event: { store: string; row?: Record<string, unknown> }) => {
    if (event.store !== 'messages') return;
    if (!event.row) return;
    const row = event.row as unknown as ChatMessage;
    if (row.user_a_id === otherUserId || row.user_b_id === otherUserId) {
      onMessage(row);
    }
  };
  return onChange(handler);
}

export function subscribeToNotifications(
  onNotification: (n: { id: string; kind: string; payload: Record<string, unknown> }) => void,
): Unsubscribe {
  const handler = (event: { store: string; row?: Record<string, unknown> }) => {
    if (event.store !== 'notifications') return;
    if (!event.row) return;
    onNotification(event.row as { id: string; kind: string; payload: Record<string, unknown> });
  };
  return onChange(handler);
}

export function subscribeToFriendChanges(
  onChange_: () => void,
): Unsubscribe {
  return onChange(({ store }) => {
    if (store === 'friends') onChange_();
  });
}
