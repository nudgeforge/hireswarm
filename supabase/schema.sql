-- HireSwarm optional Supabase persistence layer.
-- The demo works without this schema; apply it only when you want cross-session state.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  display_name text not null,
  headline text,
  location text,
  encrypted_resume_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_snapshots (
  id text primary key,
  origin text not null check (origin in ('demo_fixture', 'public_cache', 'user_pasted')),
  source text not null,
  source_url text,
  fetched_at timestamptz,
  payload jsonb not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mission_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_id text references public.job_snapshots(id) on delete set null,
  mode text not null default 'evidence_lab',
  status text not null check (status in ('queued','running','awaiting_approval','approved','completed','failed')),
  result jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.agent_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.mission_runs(id) on delete cascade,
  agent text,
  event_type text not null,
  title text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.document_patches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.mission_runs(id) on delete cascade,
  patch jsonb not null,
  evidence_ids text[] not null default '{}',
  validation_status text not null check (validation_status in ('safe_to_apply','blocked')),
  created_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.mission_runs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  approved boolean not null,
  approval_note text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.mission_runs enable row level security;
alter table public.agent_events enable row level security;
alter table public.document_patches enable row level security;
alter table public.approvals enable row level security;

create policy "users read own profile" on public.profiles for select using (auth.uid() = user_id);
create policy "users update own profile" on public.profiles for update using (auth.uid() = user_id);
create policy "users insert own profile" on public.profiles for insert with check (auth.uid() = user_id);

create policy "users read own runs" on public.mission_runs for select using (auth.uid() = user_id);
create policy "users create own runs" on public.mission_runs for insert with check (auth.uid() = user_id);
create policy "users update own runs" on public.mission_runs for update using (auth.uid() = user_id);

create policy "users read events for their runs" on public.agent_events for select using (
  exists (select 1 from public.mission_runs r where r.id = agent_events.run_id and r.user_id = auth.uid())
);
create policy "users read patches for their runs" on public.document_patches for select using (
  exists (select 1 from public.mission_runs r where r.id = document_patches.run_id and r.user_id = auth.uid())
);
create policy "users read approvals for their runs" on public.approvals for select using (
  exists (select 1 from public.mission_runs r where r.id = approvals.run_id and r.user_id = auth.uid())
);

-- Public/demo job snapshots may be read without exposing any applicant data.
alter table public.job_snapshots enable row level security;
create policy "public can read job snapshots" on public.job_snapshots for select using (true);
