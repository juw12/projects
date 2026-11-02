-- Rewind database schema for Supabase (PostgreSQL).
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: objects are created only if missing.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.shows (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  years text check (char_length(years) <= 40),
  network text check (char_length(network) <= 80),
  genre text not null default 'Misc' check (char_length(genre) <= 40),
  status text not null default 'unknown'
    check (status in ('unavailable', 'partial', 'physical', 'streaming', 'unknown')),
  synopsis text check (char_length(synopsis) <= 1000),
  why_hard_to_find text check (char_length(why_hard_to_find) <= 1000),
  theme_song text check (char_length(theme_song) <= 300),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index if not exists shows_title_unique on public.shows (lower(title));

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  author_name text not null check (char_length(author_name) between 1 and 60),
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists memories_show_idx on public.memories (show_id, created_at desc);
create index if not exists memories_recent_idx on public.memories (created_at desc);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  text text not null check (char_length(text) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists quotes_show_idx on public.quotes (show_id);

-- "I remember this" votes: one per user per show.
create table if not exists public.remembers (
  show_id uuid not null references public.shows (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (show_id, user_id)
);

-- Personal shelf (favourites): private to each user.
create table if not exists public.shelves (
  show_id uuid not null references public.shows (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (show_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Card view with counts (respects the caller's RLS)
-- ---------------------------------------------------------------------------

create or replace view public.show_cards with (security_invoker = true) as
select
  s.*,
  (select count(*) from public.memories m where m.show_id = s.id)::int as memory_count,
  (select count(*) from public.remembers r where r.show_id = s.id)::int as remember_count
from public.shows s;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Everyone can read the public tables; only signed-in users can write,
-- and only their own rows. Shelves are private.
-- ---------------------------------------------------------------------------

alter table public.shows enable row level security;
alter table public.memories enable row level security;
alter table public.quotes enable row level security;
alter table public.remembers enable row level security;
alter table public.shelves enable row level security;

drop policy if exists "shows readable by all" on public.shows;
create policy "shows readable by all" on public.shows
  for select using (true);

drop policy if exists "signed-in users add shows" on public.shows;
create policy "signed-in users add shows" on public.shows
  for insert to authenticated with check (created_by = auth.uid());

-- Any signed-in user may correct the availability status (column grant below
-- limits updates to the status column only).
drop policy if exists "signed-in users update status" on public.shows;
create policy "signed-in users update status" on public.shows
  for update to authenticated using (true) with check (true);

drop policy if exists "creators delete their shows" on public.shows;
create policy "creators delete their shows" on public.shows
  for delete to authenticated using (created_by = auth.uid());

revoke update on public.shows from anon, authenticated;
grant update (status) on public.shows to authenticated;

drop policy if exists "memories readable by all" on public.memories;
create policy "memories readable by all" on public.memories
  for select using (true);

drop policy if exists "users add own memories" on public.memories;
create policy "users add own memories" on public.memories
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "users delete own memories" on public.memories;
create policy "users delete own memories" on public.memories
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "quotes readable by all" on public.quotes;
create policy "quotes readable by all" on public.quotes
  for select using (true);

drop policy if exists "users add own quotes" on public.quotes;
create policy "users add own quotes" on public.quotes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "users delete own quotes" on public.quotes;
create policy "users delete own quotes" on public.quotes
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "remembers readable by all" on public.remembers;
create policy "remembers readable by all" on public.remembers
  for select using (true);

drop policy if exists "users add own remembers" on public.remembers;
create policy "users add own remembers" on public.remembers
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "users remove own remembers" on public.remembers;
create policy "users remove own remembers" on public.remembers
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "users read own shelf" on public.shelves;
create policy "users read own shelf" on public.shelves
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "users add to own shelf" on public.shelves;
create policy "users add to own shelf" on public.shelves
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "users remove from own shelf" on public.shelves;
create policy "users remove from own shelf" on public.shelves
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Live feed: broadcast new memories to connected browsers
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'memories'
  ) then
    alter publication supabase_realtime add table public.memories;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Starter catalogue (availability left for the community to confirm)
-- ---------------------------------------------------------------------------

insert into public.shows (title, years, network, genre, status, synopsis, why_hard_to_find, created_by)
values
  ('WKRP in Cincinnati', '1978–1982', 'CBS', 'Sitcom', 'partial',
   'The staff of a struggling Ohio radio station switches to a rock format.',
   'Much of the original rock soundtrack was replaced in later releases because of music licensing.', null),
  ('The Wonder Years', '1988–1993', 'ABC', 'Coming-of-age', 'partial',
   'Kevin Arnold grows up in the suburbs during the late 1960s and early ''70s.',
   'Its huge licensed soundtrack kept it out of home release and streaming for many years.', null),
  ('Northern Exposure', '1990–1995', 'CBS', 'Dramedy', 'partial',
   'A New York doctor is sent to practise in a quirky Alaskan town.',
   'Several music cues were swapped out on home video because of rights costs.', null),
  ('Daria', '1997–2002', 'MTV', 'Animation', 'partial',
   'A deadpan teen navigates high school in the suburb of Lawndale.',
   'Most of the original licensed music was replaced in the DVD release.', null),
  ('Freaks and Geeks', '1999–2000', 'NBC', 'Dramedy', 'unknown',
   'Two siblings fall in with very different crowds at a Michigan high school in 1980.',
   'Cancelled after one season; music clearances famously delayed its home release.', null),
  ('My So-Called Life', '1994–1995', 'ABC', 'Teen drama', 'unknown',
   'Fifteen-year-old Angela Chase navigates friendship, family and first love.',
   'A one-season cult classic that tends to drift in and out of availability.', null),
  ('Dark Skies', '1996–1997', 'NBC', 'Sci-fi', 'unknown',
   'A couple uncovers an alien conspiracy hidden behind 1960s American history.',
   'A short-lived conspiracy series with a small home-video footprint.', null),
  ('Moonlighting', '1985–1989', 'ABC', 'Dramedy', 'unknown',
   'A former model and a wisecracking detective run an LA detective agency.',
   'Music licensing kept it off streaming for decades.', null)
on conflict do nothing;
