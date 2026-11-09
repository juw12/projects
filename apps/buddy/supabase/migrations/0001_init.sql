# Buddy database schema
#
# Run this in the Supabase SQL editor, or via `supabase db push` if using the CLI.
# All tables live in the `public` schema. Row-level security is enabled on every
# table — users only see data they're authorized to see.

# =============================================================================
# profiles: extends auth.users with app-specific fields
# =============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  bio text,
  -- daily streak: incremented when both buddies complete at least one focus
  -- block today; reset when one of them misses a day.
  current_streak_days integer not null default 0,
  longest_streak_days integer not null default 0,
  last_streak_date date,
  -- total focus seconds, summed across all focus_sessions.
  total_focus_seconds integer not null default 0,
  -- user's preferred switch profile id (mirror of apps/keyin's profile id).
  active_switch_profile text not null default 'cherry-blue',
  -- user's preferred theme id.
  active_theme text not null default 'neon',
  -- last seen timestamp for presence display.
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_last_seen_idx on public.profiles (last_seen_at desc);

-- auto-create a profile row when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
# focus_sessions: every Pomodoro block the user starts
# =============================================================================

create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- planned duration in seconds (e.g. 25 * 60 for a classic Pomodoro).
  planned_seconds integer not null check (planned_seconds > 0),
  -- actual seconds completed (may be less if the user quit early).
  actual_seconds integer not null default 0,
  -- session state.
  state text not null default 'active'
    check (state in ('active', 'completed', 'aborted')),
  -- what was the user working on (optional).
  note text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index focus_sessions_user_started_idx on public.focus_sessions (user_id, started_at desc);
create index focus_sessions_state_idx on public.focus_sessions (state);

-- =============================================================================
# focus_events: realtime feed of start/end/abort events for buddies to see
# =============================================================================

create table public.focus_events (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'start', 'complete', 'abort'
  kind text not null check (kind in ('start', 'complete', 'abort')),
  -- denormalized session id for joining.
  session_id uuid references public.focus_sessions (id) on delete cascade,
  -- pre-computed payload to keep Realtime light.
  planned_seconds integer,
  note text,
  created_at timestamptz not null default now()
);

create index focus_events_user_created_idx on public.focus_events (user_id, created_at desc);

-- =============================================================================
# friends: bidirectional friendship edges
# =============================================================================

create table public.friends (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  -- 'pending' = the user_id has sent an invite; friend_id has not accepted
  -- 'accepted' = both sides have agreed
  -- 'blocked' = user_id has blocked friend_id
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'blocked')),
  -- pairing code used to invite (random short string).
  invite_code text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create unique index friends_invite_code_idx
  on public.friends (invite_code)
  where invite_code is not null;

create index friends_friend_status_idx on public.friends (friend_id, status);

-- helper view: only accepted friendships
create view public.accepted_friends as
  select user_id as a_id, friend_id as b_id from public.friends where status = 'accepted'
  union
  select friend_id as a_id, user_id as b_id from public.friends where status = 'accepted';

-- =============================================================================
# messages: 1:1 chat between buddies
# =============================================================================

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  -- the two participants; always user_a_id < user_b_id lexically (we enforce this).
  user_a_id uuid not null references auth.users (id) on delete cascade,
  user_b_id uuid not null references auth.users (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  -- message body; max ~4kb (well under Postgres toast threshold).
  body text not null check (length(body) > 0 and length(body) <= 4000),
  -- optional metadata for typing indicators, reactions, etc.
  meta jsonb,
  created_at timestamptz not null default now(),
  check (user_a_id < user_b_id),
  check (sender_id in (user_a_id, user_b_id))
);

create index messages_thread_created_idx on public.messages (user_a_id, user_b_id, created_at desc);

-- =============================================================================
# notifications: in-app notification feed
# =============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  -- human-readable payload (e.g. {"from": "Alice", "event": "completed_focus"}).
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

-- =============================================================================
# streak_days: daily completion record per user (drives shared streaks)
# =============================================================================

create table public.streak_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  -- true if the user completed at least one focus session on this day.
  completed boolean not null default false,
  focus_seconds integer not null default 0,
  primary key (user_id, day)
);

create index streak_days_user_day_idx on public.streak_days (user_id, day desc);

-- =============================================================================
# push_subscriptions: Web Push endpoints for browser / Electron
# =============================================================================

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- 'web', 'electron', 'android', 'ios'
  platform text not null check (platform in ('web', 'electron', 'android', 'ios')),
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- =============================================================================
# leaderboard view: aggregated stats for the leaderboard UI
# =============================================================================

create view public.leaderboard_weekly as
  select
    p.id as user_id,
    p.display_name,
    p.avatar_url,
    coalesce(sum(s.focus_seconds), 0)::integer as week_focus_seconds,
    count(*) filter (where s.completed)::integer as days_completed,
    p.current_streak_days,
    p.clicky_received_count
  from public.profiles p
  left join public.streak_days s
    on s.user_id = p.id
    and s.day >= current_date - interval '6 days'
  group by p.id;

-- =============================================================================
# Row-Level Security
# =============================================================================

alter table public.profiles enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.focus_events enable row level security;
alter table public.friends enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.streak_days enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles: anyone authenticated can read; only the owner can update
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- focus_sessions: only the owner can read/write
create policy "focus_sessions_owner_all"
  on public.focus_sessions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- focus_events: buddies can read; only the owner can write
create policy "focus_events_select_buddies"
  on public.focus_events for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.accepted_friends f
      where (f.a_id = auth.uid() and f.b_id = focus_events.user_id)
         or (f.b_id = auth.uid() and f.a_id = focus_events.user_id)
    )
  );

create policy "focus_events_insert_own"
  on public.focus_events for insert to authenticated
  with check (auth.uid() = user_id);

-- friends: visible to either side of the edge
create policy "friends_select_participant"
  on public.friends for select to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

create policy "friends_insert_own"
  on public.friends for insert to authenticated
  with check (auth.uid() = user_id);

create policy "friends_update_participant"
  on public.friends for update to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id)
  with check (auth.uid() = user_id or auth.uid() = friend_id);

create policy "friends_delete_participant"
  on public.friends for delete to authenticated
  using (auth.uid() = user_id);

-- messages: only the two participants can read/write
create policy "messages_select_participant"
  on public.messages for select to authenticated
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

create policy "messages_insert_sender"
  on public.messages for insert to authenticated
  with check (auth.uid() = sender_id and (auth.uid() = user_a_id or auth.uid() = user_b_id));

-- notifications: only the owner can read/update
create policy "notifications_owner_all"
  on public.notifications for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- streak_days: owner only
create policy "streak_days_owner_all"
  on public.streak_days for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- push_subscriptions: owner only
create policy "push_subscriptions_owner_all"
  on public.push_subscriptions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================================
# Realtime publication: which tables get streamed
# =============================================================================

alter publication supabase_realtime add table public.focus_events;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.friends;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.profiles;
