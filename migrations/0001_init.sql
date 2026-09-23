-- 0001_init.sql — TinyCoder Business OS day-1 schema + RLS
-- Source of truth: docs/DATA_MODEL.md (ticket 0053). Applied by paste into
-- the Supabase SQL editor — every statement below is re-runnable.
--
-- OPERATOR EMAIL: change here if login email differs
-- (single operator, magic-link auth; also referenced by is_admin() below)

-- ─── leads ────────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  email              text,                    -- nullable: contact-later / abandoned chat
  phone              text,
  business_name      text,
  type               text,                    -- one of the five services
  problem            text,
  project_description text,
  budget             text,
  timeline           text,
  source             text not null
                       check (source in ('CONCIERGE','MANUAL','OUTREACH')),
  stage              text not null default 'NEW'
                       check (stage in ('NEW','QUALIFIED','CONTACTED','PROPOSAL','WON','LOST','NURTURE')),
  priority           text default 'MEDIUM'
                       check (priority in ('LOW','MEDIUM','HIGH')),
  summary            text,                    -- LIVE field (human-approved)
  next_action        text,                    -- LIVE field (human-approved)
  notes              text,
  ai_summary         text,                    -- suggestion
  ai_priority        text,                    -- suggestion (+ visible reasons)
  ai_next_action     text,                    -- suggestion
  suggestion_status  text default 'pending'
                       check (suggestion_status in ('pending','approved','dismissed')),
  problem_tags       text[] default '{}',
  manual_today       boolean default false,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Denormalized index list (DATA_MODEL: stage, source, created_at).
create index if not exists leads_stage_idx     on public.leads (stage);
create index if not exists leads_source_idx    on public.leads (source);
create index if not exists leads_created_at_idx on public.leads (created_at);

-- updated_at: fire on every UPDATE, regardless of which column changed.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- ─── activities — auto-only log (no manual editing) ──────────────────────
create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  kind        text,      -- create | stage_change | approve | dismiss | draft | ...
  body        text,
  draft_body  text,      -- AI follow-up draft text
  -- ponytail: status is loose text, not a CHECK — kinds vary and drafts use
  -- pending|approved|sent|discarded only; tighten to a CHECK if a second
  -- consumer starts writing status.
  status      text,
  created_at  timestamptz default now()
);

create index if not exists activities_lead_id_idx on public.activities (lead_id);

-- ─── tasks — operator CRUD, nullable lead (standalone task) ──────────────
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid references public.leads (id) on delete set null,
  title      text not null,
  due_at     timestamptz,
  done       boolean default false,
  created_at timestamptz default now()
);

-- Drives the overdue-tasks view (done=false, order by due_at).
create index if not exists tasks_done_due_at_idx on public.tasks (done, due_at);

-- ─── RLS: deny-by-absence ────────────────────────────────────────────────
-- anon gets NO policies anywhere → zero rows. authenticated policies are
-- gated on is_admin(); service-role (server api/ fns) bypasses RLS for
-- inserts that have no authenticated policy (leads, activities).
alter table public.leads      enable row level security;
alter table public.activities enable row level security;
alter table public.tasks      enable row level security;

-- ─── operator allowlist ──────────────────────────────────────────────────
-- OPERATOR EMAIL is the literal in this function body (top-of-file comment).
-- ponytail: single-operator allowlist via jwt email; if a second operator
-- ever appears, replace with an allowlist table + exists() check.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
       = 'tiny-coder-2104@agentmail.to'
$$;

-- ─── policies (authenticated only; drop-then-create for re-runnability) ──
-- leads: SELECT, UPDATE only. No INSERT — server fns use service-role.
drop policy if exists "leads_select_admin" on public.leads;
create policy "leads_select_admin"
  on public.leads for select
  to authenticated
  using (public.is_admin());

drop policy if exists "leads_update_admin" on public.leads;
create policy "leads_update_admin"
  on public.leads for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- activities: SELECT only — system events are written by service-role.
drop policy if exists "activities_select_admin" on public.activities;
create policy "activities_select_admin"
  on public.activities for select
  to authenticated
  using (public.is_admin());

-- tasks: full operator CRUD (no server fn needed for tasks day-1).
drop policy if exists "tasks_select_admin" on public.tasks;
create policy "tasks_select_admin"
  on public.tasks for select
  to authenticated
  using (public.is_admin());

drop policy if exists "tasks_insert_admin" on public.tasks;
create policy "tasks_insert_admin"
  on public.tasks for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "tasks_update_admin" on public.tasks;
create policy "tasks_update_admin"
  on public.tasks for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "tasks_delete_admin" on public.tasks;
create policy "tasks_delete_admin"
  on public.tasks for delete
  to authenticated
  using (public.is_admin());
