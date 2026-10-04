-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
create table if not exists public.state (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.state enable row level security;

drop policy if exists "own rows select" on public.state;
drop policy if exists "own rows insert" on public.state;
drop policy if exists "own rows update" on public.state;
drop policy if exists "own rows delete" on public.state;
create policy "own rows select" on public.state for select using (auth.uid() = user_id);
create policy "own rows insert" on public.state for insert with check (auth.uid() = user_id);
create policy "own rows update" on public.state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows delete" on public.state for delete using (auth.uid() = user_id);

-- Server-side timestamps, so device clocks never matter for "what changed".
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists state_touch on public.state;
create trigger state_touch before insert or update on public.state
  for each row execute function public.touch_updated_at();

-- Lets a signed-in user delete their own account; their rows in public.state go with it (on delete cascade).
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
