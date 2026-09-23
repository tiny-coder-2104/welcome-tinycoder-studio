# PIPELINE_SPEC.md — Stages, lead fields, next-action ranking

Grounded in tickets 0052 (stages + ranking), 0053 (schema), 0054 (manual entry +
detail), 0059 (overdue tasks + transitions).

## 1. The 7 stages

```
                ┌──────────────────────────────────────────┐
                │                                          │
                ▼                                          │
             [NEW] ──qualify──► [QUALIFIED] ──reach out──► [CONTACTED]
                                   │ ▲                         │
                                   │ └───── reactivate ────────┤
                                   ▼                           ▼
                              [NURTURE] ◄──go dark──    [PROPOSAL]
                              (any active stage)            │
                                              ┌─────────────┴─────────────┐
                                              ▼                           ▼
                                            [WON]                       [LOST]
```

| Stage | Meaning | Exit |
|---|---|---|
| NEW | Captured (concierge or manual). Not yet assessed. | qualify → QUALIFIED, or NURTURE/LOST |
| QUALIFIED | Real problem, reachable, plausible fit. | CONTACTED |
| CONTACTED | First outreach done, awaiting reply. | PROPOSAL, NURTURE |
| PROPOSAL | Quote/proposal sent. | WON, LOST, NURTURE |
| NURTURE | Go-dark / not now. Branch from any active stage. | back to QUALIFIED (reactivate) |
| WON | Closed won → spawns `projects` row (later phase). | terminal |
| LOST | Closed lost. | terminal |

- Valid transition set is enforced server-side — **no drift** (0059 negative test).
- Stage change writes an auto `activities` row (auto-only log).
- No separate prospects table: resort outreach = `source='OUTREACH'` leads.

## 2. Lead fields (spec §5 working definition)

Synthesized from ticket 0055 marker payload + ticket 0053 schema columns.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text | required |
| `email` | text | nullable (contact-later / abandoned chat — confirm in 0059) |
| `phone` | text | optional |
| `business_name` | text | optional |
| `type` | text | one of the five services |
| `problem` | text | from qualification |
| `project_description` | text | scope / features / use case |
| `budget` | text | optional, as volunteered |
| `timeline` | text | when they need it |
| `source` | text | `CONCIERGE` \| `MANUAL` \| `OUTREACH` |
| `stage` | enum | 7 values above |
| `priority` | enum | `LOW`/`MEDIUM`/`HIGH` — **no scoring engine** |
| `summary` | text | live field (AI writes to `ai_summary`, human approves) |
| `next_action` | text | live field (from `ai_next_action`) |
| `notes` | text | operator notes, editable |
| `ai_summary` | text | suggestion, pending |
| `ai_priority` | enum | suggestion + visible reasons, pending |
| `ai_next_action` | text | suggestion, pending |
| `suggestion_status` | enum | `pending`\|`approved`\|`dismissed` |
| `problem_tags` | text[] | editable, free-form (see `OPPORTUNITY_SPEC.md`) |
| `manual_today` | bool | operator flag: "act on this today" |
| `created_at` / `updated_at` | timestamptz | |

Manual lead create/edit ships day-1 (0054) with the same fields — prevents an
empty-dashboard shelfware launch.

## 3. Next-action ranking

Deterministic, no model in the loop. Three rules, applied in order:

1. **`manual_today = true` wins.** Operator said so; nothing outranks it.
2. **Qualified leads with no activity in >48 h** — oldest idle first. (The
   follow-up clock: a QUALIFIED lead you haven't touched in two days is the
   revenue risk.)
3. **Oldest by stage depth** — among remaining active leads (NEW → QUALIFIED →
   CONTACTED → PROPOSAL), oldest `created_at`/`updated_at` first; deeper stage
   breaks ties (a stale PROPOSAL beats a stale NEW).

**Overdue tasks** (0059) surface as their own rows at **tier 1**, alongside
`manual_today` — an overdue task is "act now" by definition. Task rows use the
parent lead's stage; standalone tasks (`lead_id` null) show stage `-`.

### Output row shape (one per line)

```
name | stage | why | suggested action
```

Examples:

```
DavaoBook      | QUALIFIED | manual_today set by you        | Send proposal draft
Acme Resorts   | CONTACTED | qualified, 3 days no activity  | Follow up — check inbox
Bayside Inn    | PROPOSAL  | proposal out 6 days            | Call to close
(task) Submit contract | PROPOSAL | task overdue: "send contract" | Do it today
```

## 4. Priority

`LOW`/`MEDIUM`/`HIGH` with **displayed reasons** — set by human, optionally
seeded from `ai_priority` via the approval gate. No numeric score, no weights.

## 5. Dedupe

Same email twice → not a second row; update existing lead / flag for human
merge (0059 negative test). Server-side check on insert.
