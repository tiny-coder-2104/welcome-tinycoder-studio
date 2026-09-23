# BUSINESS_OS_SPEC.md — TinyCoder Business OS (consolidated product spec)

Condensed product spec for turning the Virtual Office lobby into a solo-freelancer
business operating system. Synthesized from Oracle rulings + tickets 0052–0059.
Not a copy of any master document — section numbers (§5, §9, §11, §14, §19, §28,
§29, §31) refer to the master spec held out-of-band; working definitions live in
the linked docs here.

## Goal

One person, one screen: every inbound conversation becomes a tracked lead, every
lead gets a clear next action, and AI does the typing while the human does the
deciding. The dashboard is a **notification surface** — you open it to see what
needs action today, not to browse.

## Principles (the rulings, as product behavior)

| Ruling | What it means in practice |
|---|---|
| 7-stage pipeline | NEW → QUALIFIED → CONTACTED → PROPOSAL → WON / LOST, NURTURE branch. See `PIPELINE_SPEC.md`. |
| Auto-only activity log | `activities` rows are written by system events only (create, stage change, approval, draft). No manual log editing. |
| Merged prospects | No `prospects` table. Resort outreach experiment = leads with `source='OUTREACH'`. |
| AI approval gates | AI writes `ai_*` columns with `suggestion_status='pending'`. Human approves → copied to live fields + activity row. AI never mutates live fields, never makes high-impact decisions. |
| KB as static module | Business facts live in a static module, not the system prompt and not a DB table. No KB admin UI. |
| Dashboard-as-notification | TODAY view = counts + ranked NEXT ACTIONS. Everything else is one click away. |
| Vanilla stack + `/dashboard/` | No framework, no build step. Static `/dashboard/` dir in this repo. Public lobby untouched. |
| Magic-link + deny-all RLS | Only allowlisted operator email gets a session; RLS is the real gate, path is obscurity only. |
| Server-side `__ORDER__` | Marker stripped, validated, and inserted server-side. Client never sees the marker; invalid payloads never reach the DB. |
| Manual entry day-1 | Dashboard ships with a manual lead form so it is useful before concierge capture lands. |
| Deferred opportunities | `problem_tags` now; `opportunities` table only after the 3+/3+ trigger AND ≥2 manual reviews. No AI pattern detector. |
| Weekly brief gated on habit | Build only after ~2 weeks of daily dashboard use (human confirms). Manual button, no cron. |

## Surfaces

```
PUBLIC                          OPERATOR
──────                          ────────
Lobby (/)        ── leads ──►   /dashboard/  (magic link, RLS)
  FAQ pills (local)              TODAY  counts + NEXT ACTIONS
  "I have a project" pill        PIPELINE  7 columns → lead list
  free chat (/api/chat)          LEAD DETAIL  WHO/WHAT/WHY/URGENCY/FIT/NEXT (§31)
  order flow (/api/order)        MANUAL ENTRY  create/edit, source incl. OUTREACH
                                 APPROVALS  ai_* pending → approve/dismiss
                                 BRIEF      manual "generate weekly" (habit-gated)
```

## Data (day-1 → later)

- **Day-1:** `leads`, `activities`, `tasks` — see `DATA_MODEL.md`.
- **Later:** `projects` (after WON), `opportunities` (on trigger — see
  `OPPORTUNITY_SPEC.md`).
- **Never:** separate `prospects` table (merged), KB table (static module),
  cron/scheduler in v1.

## AI scope

AI prepares; humans approve; the system executes.

- **AI does:** draft `ai_summary` (§11 format), `ai_priority` (+ visible reasons),
  `ai_next_action`; draft follow-up message text (`activities.kind='draft'`,
  `status='pending'`); answer concierge questions from KB.
- **AI never does:** mutate live lead fields, change stage to WON/LOST, send email,
  invent capabilities/prices/clients/testimonials, decide pricing, detect patterns
  at solo volume.
- **No auto-send path exists anywhere.** Any future AgentMail send function takes
  an approved suggestion id only, re-verifies status server-side, never accepts raw
  to/body from the client.

## Non-goals

No backend framework. No prospects table. No AI pattern detector. No auto-send
email. No scoring engine (priority stays LOW/MEDIUM/HIGH with displayed reasons).
No cron. No PWA manifest/service worker work in this phase (README's "PWA" claim
is aspirational — see `AUDIT.md`).

## Doc index

| Doc | Covers |
|---|---|
| `AUDIT.md` | What exists today, line-verified |
| `CONCIERGE_SPEC.md` | Answer / intent / qualify / capture, KB, "I have a project" |
| `PIPELINE_SPEC.md` | 7 stages, lead fields (§5), next-action ranking |
| `OPPORTUNITY_SPEC.md` | `problem_tags` now, 3+/3+ trigger, anti-goals |
| `DATA_MODEL.md` | Tables, RLS intent, approval-gate flow, secrets |
| `ROADMAP.md` | Phases 1–7 ↔ tickets 0053–0059, acceptance criteria (§28) |
