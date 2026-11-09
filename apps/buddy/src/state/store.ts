/**
 * Buddy's renderer state. Single zustand store holds the local user,
 * focus session, buddy list, active chat, theme, recent key events (for
 * the particle canvas), and UI flags.
 */

import { create } from 'zustand';
import type { ChatMessage, FriendEdge, FocusSession, KeyboardEvent, LeaderboardEntry, UserProfile } from '@shared/types';

interface BuddyState {
  profile: UserProfile | null;
  ready: boolean;
  setProfile: (profile: UserProfile | null) => void;
  setReady: (ready: boolean) => void;

  buddies: FriendEdge[];
  setBuddies: (buddies: FriendEdge[]) => void;

  activeFocus: FocusSession | null;
  setActiveFocus: (session: FocusSession | null) => void;

  chat: {
    activeBuddyId: string | null;
    messagesByBuddy: Record<string, ChatMessage[]>;
  };
  openChat: (buddyId: string) => void;
  closeChat: () => void;
  appendMessage: (buddyId: string, msg: ChatMessage) => void;
  setMessages: (buddyId: string, msgs: ChatMessage[]) => void;

  leaderboard: LeaderboardEntry[];
  setLeaderboard: (entries: LeaderboardEntry[]) => void;

  themeId: 'minimal' | 'neon' | 'synthwave';
  setTheme: (id: 'minimal' | 'neon' | 'synthwave') => void;

  recent: (KeyboardEvent & { arrivalMs: number })[];
  setRecent: (event: KeyboardEvent & { arrivalMs: number }) => void;
}

export const useBuddyStore = create<BuddyState>((set) => ({
  profile: null,
  ready: false,
  setProfile: (profile) => set({ profile }),
  setReady: (ready) => set({ ready }),

  buddies: [],
  setBuddies: (buddies) => set({ buddies }),

  activeFocus: null,
  setActiveFocus: (session) => set({ activeFocus: session }),

  chat: { activeBuddyId: null, messagesByBuddy: {} },
  openChat: (buddyId) =>
    set((s) => ({ chat: { ...s.chat, activeBuddyId: buddyId } })),
  closeChat: () =>
    set((s) => ({ chat: { ...s.chat, activeBuddyId: null } })),
  appendMessage: (buddyId, msg) =>
    set((s) => {
      const existing = s.chat.messagesByBuddy[buddyId] ?? [];
      if (existing.some((m) => m.id === msg.id)) return s;
      return {
        chat: {
          ...s.chat,
          messagesByBuddy: { ...s.chat.messagesByBuddy, [buddyId]: [...existing, msg] },
        },
      };
    }),
  setMessages: (buddyId, msgs) =>
    set((s) => ({
      chat: {
        ...s.chat,
        messagesByBuddy: { ...s.chat.messagesByBuddy, [buddyId]: msgs },
      },
    })),

  leaderboard: [],
  setLeaderboard: (entries) => set({ leaderboard: entries }),

  themeId: 'neon',
  setTheme: (id) => set({ themeId: id }),

  recent: [],
  setRecent: (event) =>
    set((s) => ({ recent: [event, ...s.recent].slice(0, 32) })),
}));
