# Buddy — Clicky migration
#
# Adds the Clicky counter mechanic from Farza's Clicky project:
#   - profiles.clicky_count = how many clickies this user has given out
#   - profiles.clicky_received_count = how many this user has received
#   - clicky_events = per-event log (for the in-app feed + analytics)
#   - give_clicky RPC = atomic increment + event insert

# =============================================================================
# Add clicky columns to profiles
# =============================================================================

alter table public.profiles
  add column if not exists clicky_count integer not null default 0,
  add column if not exists clicky_received_count integer not null default 0;

# =============================================================================
# clicky_events: every clicky granted
# =============================================================================

create table public.clicky_events (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id uuid not null references auth.users (id) on delete cascade,
  -- 'manual' = button on the profile
  -- 'message' = auto-fired when this user sends a message
  -- 'focus_complete' = auto-fired when this user completes a focus block
  source text not null check (source in ('manual', 'message', 'focus_complete')),
  created_at timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);

create index clicky_events_to_created_idx
  on public.clicky_events (to_user_id, created_at desc);

create index clicky_events_from_created_idx
  on public.clicky_events (from_user_id, created_at desc);

# =============================================================================
# Row-Level Security
# =============================================================================

alter table public.clicky_events enable row level security;

-- Either the sender or the recipient can see the clicky event.
create policy "clicky_events_select_own_or_recipient"
  on public.clicky_events for select to authenticated
  using (auth.uid() = from_user_id or auth.uid() = to_user_id);

-- Only the sender can create a clicky event (we'll trust the RPC to set from_user_id).
create policy "clicky_events_insert_sender"
  on public.clicky_events for insert to authenticated
  with check (auth.uid() = from_user_id);

# =============================================================================
# give_clicky RPC: atomic insert + counter increment
# =============================================================================

create or replace function public.give_clicky(
  p_to_user_id uuid,
  p_source text default 'manual'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_user_id uuid := auth.uid();
begin
  if v_from_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if v_from_user_id = p_to_user_id then
    raise exception 'Cannot clicky yourself';
  end if;

  insert into public.clicky_events (from_user_id, to_user_id, source)
    values (v_from_user_id, p_to_user_id, p_source);

  update public.profiles
    set clicky_count = clicky_count + 1
    where id = v_from_user_id;

  update public.profiles
    set clicky_received_count = clicky_received_count + 1
    where id = p_to_user_id;
end;
$$;

# =============================================================================
# Stream clicky_events via Realtime so the recipient sees the notification
# =============================================================================

alter publication supabase_realtime add table public.clicky_events;
