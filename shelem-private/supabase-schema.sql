-- Run in the Supabase SQL Editor; never expose server secrets to browsers.
create table if not exists public.shelem_snapshots (
 id text primary key check (id = 'main'),
 payload jsonb not null
);
alter table public.shelem_snapshots enable row level security;
revoke all on public.shelem_snapshots from anon, authenticated;
grant select, insert, update on public.shelem_snapshots to service_role;
-- Deliberately no public RLS policies: hands and session tokens are server-only.
