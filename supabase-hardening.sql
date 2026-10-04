-- Run AFTER supabase-setup.sql (SQL Editor -> New query -> Run). Safe to re-run.
-- Lock-down for the key/value table the app syncs through: anon has no access, signed-in users only ever see their own rows.

revoke all on public.state from anon;
do $$ begin
  alter table public.state add constraint state_key_len check (char_length(key) between 1 and 120) not valid;
  alter table public.state add constraint state_value_size check (octet_length(value::text) < 2000000) not valid;   -- ~2 MB cap per key
exception when duplicate_object then null; end $$;
alter policy "own rows select" on public.state to authenticated;
alter policy "own rows insert" on public.state to authenticated;
alter policy "own rows update" on public.state to authenticated;
alter policy "own rows delete" on public.state to authenticated;

-- Verify (all rows must show rls = true; anon must have no privileges):
--   select c.relname, c.relrowsecurity as rls from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r';
--   select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee='anon';

-- Keepalive target: lets the keepalive workflow reach Postgres without exposing any table.
create or replace function public.ping() returns int language sql stable set search_path = '' as $$ select 1 $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
