# OPPORTUNITY_SPEC.md — problem_tags now, opportunities table deferred

Ticket 0058 is the source of truth; this doc is the consolidated design.
**Anti-goal up front: no AI pattern detector.** At solo volume it hallucinates
signal (loki/dev-worker ruling). Detection is a human with a tag filter.

## Part A — `problem_tags` (ships now, day-1-ish)

- `problem_tags text[]` column on `leads` (in `DATA_MODEL.md`).
- Editable on lead detail: simple multi-select / free-form text input.
  **No taxonomy admin, no tag CRUD screens.**
- Seeded from the concierge `problem` field (suggested tags), then free-form add.
- Filterable from the lead list ("show me every lead tagged `no-show-bookings`").
- Tags are the *only* opportunity signal until Part C unlocks.

## Part B — manual monthly review (process, not code)

Once a month, operator filters leads by tag and asks one question:

> **Which tag has appeared 3+ times across 3+ distinct businesses?**

- Record findings in the spec notes (a paragraph in this file or a linked notes
  doc — not a table, not a UI).
- This is a spreadsheet-and-coffee exercise. The dashboard only makes the
  filtering cheap.

Trigger conditions that must BOTH hold before Part C:

1. A single tag has hit **3+ occurrences across 3+ businesses**.
2. The manual review has been performed **≥2 times** (i.e. the pattern survived
   two separate looks).

Ticket 0052's looser phrasing ("3+ after manual monthly review") is superseded by
ticket 0058's stricter wording — **0058 wins.**

## Part C — `opportunities` table (trigger-gated, not built yet)

Created ONLY after the trigger above is confirmed by a human. Working definition
of spec §14 fields/statuses (minimal):

| Field | Notes |
|---|---|
| `id` | uuid pk |
| `problem_tag` | the tag that triggered it |
| `description` | what the recurring problem is, in one paragraph |
| `occurrences` | count of leads carrying the tag |
| `business_count` | distinct businesses affected |
| `status` | `PROPOSED` → `VALIDATING` → `LAUNCHED` \| `REJECTED` |
| `review_count` | manual reviews performed so far |
| `evidence_lead_ids` | uuid[] — the leads that justified it |
| `first_seen` / `last_seen` | timestamptz |
| `notes` | operator notes |

Until the trigger: **no `opportunities` table exists** (not even empty), no admin
UI for it, no AI scanning for it. Ticket 0058 Part C stays `Todo` until a human
confirms the condition.

## Explicit non-goals

- No AI/ML pattern detection, clustering, or "insight engine".
- No automatic opportunity row creation — a human writes the paragraph.
- No scoring, no trend graphs, no forecasting.
- Weekly brief's "top opportunity" (ticket 0057) reads **`problem_tags` counts on
  leads**, not this table — the table may not exist when the brief ships.
