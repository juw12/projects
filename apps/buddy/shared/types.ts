/**
 * Shared types between Electron main process, renderer, and Supabase.
 * Both processes import from here so contracts stay in sync.
 */

export type UUID = string;
export type ISODateString = string;

/** Profile row from public.profiles, denormalized for the renderer. */
export interface UserProfile {
  id: UUID;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  current_streak_days: number;
  longest_streak_days: number;
  last_streak_date: string | null;
  total_focus_seconds: number;
  active_switch_profile: string;
  active_theme: 'minimal' | 'neon' | 'synthwave';
  last_seen_at: ISODateString;
  created_at: ISODateString;
  clicky_count: number;
  clicky_received_count: number;
  [key: string]: unknown;
}

/** Friend edge — what the renderer shows. */
export interface FriendEdge {
  user_id: UUID;
  friend_id: UUID;
  status: 'pending' | 'accepted' | 'blocked';
  invite_code: string | null;
  created_at: ISODateString;
  accepted_at: ISODateString | null;
  /** The "other" side's profile, joined for display. */
  profile: UserProfile | null;
  [key: string]: unknown;
}

/** Live presence — what the buddy is doing right now. */
export interface Presence {
  user_id: UUID;
  state: 'idle' | 'focusing' | 'break' | 'offline';
  /** Remaining seconds in the current state (0 if idle/offline). */
  remaining_seconds: number;
  /** Current session id, if focusing or on break. */
  session_id: UUID | null;
  updated_at: ISODateString;
}

/** Focus session record. */
export interface FocusSession {
  id: UUID;
  user_id: UUID;
  planned_seconds: number;
  actual_seconds: number;
  state: 'active' | 'completed' | 'aborted';
  note: string | null;
  started_at: ISODateString;
  ended_at: ISODateString | null;
  [key: string]: unknown;
}

/** A focus event streamed via Realtime. */
export interface FocusEvent {
  id: number;
  user_id: UUID;
  kind: 'start' | 'complete' | 'abort';
  session_id: UUID | null;
  planned_seconds: number | null;
  note: string | null;
  created_at: ISODateString;
  [key: string]: unknown;
}

/** A chat message between two buddies. */
export interface ChatMessage {
  id: UUID;
  user_a_id: UUID;
  user_b_id: UUID;
  sender_id: UUID;
  body: string;
  meta: Record<string, unknown> | null;
  created_at: ISODateString;
  [key: string]: unknown;
}

/** In-app notification. */
export interface AppNotification {
  id: UUID;
  user_id: UUID;
  kind: string;
  payload: Record<string, unknown>;
  read_at: ISODateString | null;
  created_at: ISODateString;
}

/** Aggregate stats for the leaderboard. */
export interface LeaderboardEntry {
  user_id: UUID;
  display_name: string;
  avatar_url: string | null;
  week_focus_seconds: number;
  days_completed: number;
  current_streak_days: number;
  clicky_received_count?: number;
}

export interface SwitchProfile {
  id: string;
  name: string;
  clickFreq: number;
  clickQ: number;
  clickGain: number;
  bodyGain: number;
  bodyDecayMs: number;
  pitchJitterCents: number;
  hasReleaseClick: boolean;
  accentColor: string;
}

/** System-wide keyboard event from the OS hook (Windows PowerShell, etc). */
export interface KeyboardEvent {
  /** Virtual key code (Windows VK_* / macOS kVK_* / Linux XKB). */
  vk: number;
  /** Hardware scan code. */
  scanCode: number;
  /** 'down' for key press, 'up' for release. */
  type: 'down' | 'up';
  /** Unix epoch ms when the OS captured the event. */
  timestamp: number;
  /** Modifier state at capture time. */
  modifiers: {
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
  };
}
