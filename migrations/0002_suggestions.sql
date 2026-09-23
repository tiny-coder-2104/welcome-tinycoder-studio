-- 0002_suggestions.sql — approval-gate support (ticket 0056).
-- Source of truth: docs/DATA_MODEL.md §Approval-gate data flow.
-- Applied by paste into the Supabase SQL editor — every statement below is
-- re-runnable (paste twice = same result).
--
-- Why not in 0001: ai_priority_reason ("+ visible reasons", spec §12) was
-- missed by 0053; activities client-write policies arrive with the dashboard
-- approve/dismiss UI (0056).

-- ─── leads: visible priority reason ───────────────────────────────────────
alter table public.leads add column if not exists ai_priority_reason text;

-- ─── activities: authenticated operator writes (0056) ─────────────────────
-- approve/dismiss audit rows + draft sent/discarded flips come from the
-- dashboard session (magic link → is_admin()). RLS stays the gate per
-- DATA_MODEL. Service-role paths (create / stage_change / draft generation
-- in api/) bypass RLS — untouched.

drop policy if exists "activities_insert_admin" on public.activities;
create policy "activities_insert_admin"
  on public.activities for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "activities_update_admin" on public.activities;
create policy "activities_update_admin"
  on public.activities for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
