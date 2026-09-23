# ROADMAP.md — Business OS phases ↔ tickets (spec §28 condensed)

Phase labels follow the tickets (canonical). Ticket 0052's title says "spec §28
phases 1-2 merged" — that referred to the master spec's phase list; in this repo
the docs/audit phase is Phase 1 and the schema phase is Phase 2 (ticket 0053).
No ambiguity once these labels are used.

```
Phase 1  AUDIT + specs .............. tinycoder-0052  (this commit)
Phase 2  Supabase schema + RLS ...... tinycoder-0053  ← depends on 0052
Phase 3  Dashboard shell ............ tinycoder-0054  ← depends on 0053
Phase 4  Concierge lead capture ..... tinycoder-0055  ← depends on 0053
Phase 5  AI suggestions + gates ..... tinycoder-0056  ← depends on 0054, 0055
Phase 6  Weekly brief (habit-gated) . tinycoder-0057  ← depends on 0056
Phase 7  Problem tags + opps trigger  tinycoder-0058  ← depends on 0055
(+)      End-to-end path testing .... tinycoder-0059  ← run after Phase 5
```

Phases 3 and 4 are parallel once 2 lands. 5 needs both. 6 waits on **two**
gates: code dependency (0056) and the human habit gate (~2 weeks daily use —
confirm with human before starting). 7 Part A rides with/after 4; Part C waits
on its own trigger.

## Phase detail

### Phase 1 — AUDIT + spec docs — `tinycoder-0052` (this commit)
- Deliverables: `AUDIT.md` + `docs/` × 6 (this file included).
- Acceptance: docs committed; no code changes. ✅

### Phase 2 — Supabase schema + RLS — `tinycoder-0053` (critical)
- `migrations/` dir, versioned `.sql`, applied via SQL-editor paste (no CLI).
- Day-1 tables only: `leads`, `activities`, `tasks`. No prospects/projects/opps.
- RLS: deny-all default; admin = allowlisted email via `auth.uid()` check;
  anon gets SELECT/INSERT/UPDATE nowhere; lead INSERT only via service-role.
- Env: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
- **Acceptance:** anon reads zero rows on all tables (tested from SQL editor);
  migrations runnable on a fresh Supabase project.

### Phase 3 — Dashboard shell — `tinycoder-0054`
- Static `/dashboard/`, vanilla HTML/ES-modules, no build step. Lobby untouched.
- Magic-link auth; only allowlisted operator email gets a session.
- TODAY view: counts (new, qualified, follow-ups due, active) + NEXT ACTIONS per
  `PIPELINE_SPEC` ranking — one row each: name, stage, why, suggested action.
- Pipeline board: 7 columns → lead list.
- Lead detail: WHO/WHAT/WHY/URGENCY/FIT/NEXT ACTION readable in <30 s (§31);
  stage change button (writes auto activity row); notes field.
- Manual lead create/edit (day-1) with `source` incl. `OUTREACH`.
- Validated mutations via `api/` + service-role; reads via anon key + RLS session.
- **Acceptance:** logged-out visitor gets zero data; ranking correct; manual lead
  create + stage moves work; lobby/concierge unaffected.

### Phase 4 — Concierge lead capture — `tinycoder-0055` (critical)
- KB module: business facts out of the system prompt; prompt = KB text +
  behavioral instructions at runtime. No KB table, no admin UI.
- Marker grows to full lead fields (name, email, phone?, business_name, type,
  problem, project_description, budget, timeline, source=CONCIERGE, stage=NEW).
- Server-side parse + validate + service-role insert in `api/chat.js`; strip
  marker before returning text; invalid → log + drop, no user-facing error, no
  partial write. Keep order-email path working (choice: keep `/api/order`
  untouched day-1 — see `CONCIERGE_SPEC.md`).
- "I have a project" lobby pill → progressive qualification → confirmation per §9.
- Reuse rate limiter + abuse blocklist; `POTENTIAL_CLIENT` intent gate.
- **Acceptance:** visitor describes project → lead row in dashboard → no marker
  leakage in chat; invalid/hallucinated fields never reach DB; FAQ still matches
  KB facts.

### Phase 5 — AI suggestions + approval gates — `tinycoder-0056`
- Server-side generation on lead create/stage change → `ai_summary` (§11 format),
  `ai_priority` (+ visible reasons), `ai_next_action`, `suggestion_status='pending'`.
  Schema-validate model output; invalid → null + log, never garbage in live fields.
- Lead-detail approval UI: Approve copies `ai_*` → live fields + flips status +
  writes activity row. Dismiss clears.
- Follow-up draft = activity `kind='draft'`, `status='pending'`; human sends
  manually in v1. **Hard rule:** future send fn takes approved suggestion id
  only, re-verifies server-side, never raw to/body from client.
- Priority stays LOW/MEDIUM/HIGH with displayed reasons — no scoring engine.
- **Acceptance:** AI never mutates live fields (verify by DB inspection);
  approve/dismiss works; no auto-send path exists anywhere.

### Phase 6 — Weekly business brief — `tinycoder-0057` (habit-gated)
- **Gate first:** operator has used the dashboard daily ~2 weeks. Ask a human
  before writing any code (shelfware rule).
- Manual "Generate weekly brief" button — no scheduler/cron in v1.
- Assembles §19: period, new/qualified/proposals/projects counts, follow-ups due,
  top opportunity (by `problem_tags` count on leads — the opportunities table may
  not exist yet), problem-tag list, recommended actions (from ranking rules).
- Render as a dashboard page. Email delivery = separate later decision.
- **Acceptance:** one click → readable 2-minute brief from real data; no invented
  numbers (only DB counts).

### Phase 7 — Problem tags + opportunity trigger — `tinycoder-0058` (low)
- Part A (with/after Phase 4): `problem_tags` editable on lead detail, seeded
  from concierge problem, free-form, filterable from lead list. No taxonomy admin.
- Part B (manual, monthly): review leads by tag — "which tag hit 3+ across 3+?"
  Document findings in spec notes.
- Part C (TRIGGER-GATED): create `opportunities` table (§14 fields) ONLY after a
  tag hits 3+ occurrences across 3+ businesses AND review done ≥2 times. Until
  then: no table, no AI pattern detector.
- **Acceptance:** Part A tags editable/filterable; Part C stays Todo until a
  human confirms the trigger.

### End-to-end testing — `tinycoder-0059` (run after Phase 5)
- Path: visitor → "I have a project" → qualification → lead row → AI pending →
  approve → appears in NEXT ACTIONS → stage transition logs activity → draft pending.
- Negatives: duplicate email; missing/empty marker (no insert, logged); spam flood
  (rate limiter); anon reads zero rows (RLS); service-role key absent from client
  bundle (grep); malformed marker → dropped; hallucinated field → only user-given
  values accepted; stage transitions limited to 7; overdue tasks in ranking;
  abandoned no-email conversation → contact-later behavior matches spec; lobby FAQ
  regression.
- Inline `demo()` checks only — no test framework (house style).
- **Acceptance:** checklist all green or filed as follow-up tickets.
