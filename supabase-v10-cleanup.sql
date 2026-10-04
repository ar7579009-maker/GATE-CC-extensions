-- Run ONCE on a project that already ran the v9 supabase-hardening.sql. Removes objects the app never used. Safe to re-run.
drop view if exists public.daily_hours, public.weekly_hours, public.monthly_hours;
drop table if exists public.study_sessions;

-- Keepalive target (used by .github/workflows/keepalive.yml).
create or replace function public.ping() returns int language sql stable set search_path = '' as $$ select 1 $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
