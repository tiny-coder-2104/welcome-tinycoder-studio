# DATA_MODEL.md — Tables, RLS, approval gates, secrets

Ticket 0053 (schema + RLS) and 0056 (approval gates) are the source of truth.
Migrations live in `migrations/` as versioned `.sql` files — source of truth,
applied by paste into the Supabase SQL editor (no CLI).

## Day-1 tables

### `leads`

```
id              uuid pk
name            text not null
email           text                    -- nullable: contact-later / abandoned chat
phone           text
business_name   text
type            text                    -- one of the five services
problem         text
project_description text
budget          text
timeline        text
source          text not null           -- CONCIERGE | MANUAL | OUTREACH
stage           text not null default 'NEW'
                                      -- NEW|QUALIFIED|CONTACTED|PROPOSAL|WON|LOST|NURTURE
priority        text default 'MEDIUM'   -- LOW|MEDIUM|HIGH, no scoring engine
summary         text                    -- LIVE field (human-approved)
next_action     text                    -- LIVE field (human-approved)
notes           text
ai_summary      text                    -- suggestion
ai_priority      text                    -- suggestion (+ visible reasons)
ai_priority_reason text                  -- visible reason behind ai_priority (0002)
ai_next_action  text                    -- suggestion
suggestion_status text default 'pending' -- pending|approved|dismissed
problem_tags    text[] default '{}'
manual_today    boolean default false
created_at      timestamptz default now()
updated_at      timestamptz default now()
```

No `prospects` table (merged — resort outreach is `source='OUTREACH'`).
No `projects` table (defer to WON). No `opportunities` table (deferred, see
`OPPORTUNITY_SPEC.md`).

### `activities` — auto-only log

```
id          uuid pk
lead_id     uuid not null FK → leads
kind        text      -- create | stage_change | approve | dismiss | draft | ...
body        text
draft_body  text      -- AI follow-up draft text
status      text      -- for drafts: pending | approved | sent | discarded
created_at  timestamptz default now()
```

Written by system events only. No manual editing, no UI to "add activity".

### `tasks`

```
id          uuid pk
lead_id     uuid FK → leads            -- nullable (standalone task)
title       text not null
due_at      timestamptz
done        boolean default false
created_at  timestamptz default now()
```

## Later tables

| Table | Unlocks when |
|---|---|
| `projects` | a lead hits `WON` |
| `opportunities` | tag ≥3 occurrences across ≥3 businesses AND manual review done ≥2 times (human-confirmed) |

## RLS intent table

Deny-all by default. `anon` gets **nothing** anywhere. `authenticated` is
effectively just the operator.

| Table | role | ops | How |
|---|---|---|---|
| leads | anon | — | no policy → zero rows |
| leads | authenticated (allowlisted email via `auth.uid()` check fn) | SELECT, UPDATE | magic-link session |
| leads | service-role | INSERT (and validated UPDATE) | server `api/` fn only — **no anon INSERT policy** |
| activities | anon | — | no policy |
| activities | authenticated (allowlist) | SELECT, INSERT, UPDATE | magic-link (0056: approve/dismiss rows, draft status flips) |
| activities | service-role | INSERT | server fn only (system events) |
| tasks | anon | — | no policy |
| tasks | authenticated (allowlist) | SELECT, INSERT, UPDATE, DELETE | magic-link (operator CRUD) |
| tasks | service-role | * | server fns needing validation |

- Admin check = `auth.uid()` matches allowlisted email (single operator).
- Auth = Supabase magic link; only the allowlisted email gets a session.
  `/dashboard/` path is obscurity only — **RLS is the real gate.**
- Reads use anon key + RLS session; mutations that need validation go through
  `api/` functions holding the service-role key (0054.6).
- Acceptance (0053): anon reads zero rows on all tables, tested from the SQL
  editor.

## Approval-gate data flow

Principle: **AI prepares → human approves → system executes.** The gate is the
product; AI is data entry.

```
lead created / stage changed
        │
        ▼
server generates ai_summary, ai_priority, ai_next_action
   suggestion_status = 'pending'          (schema-validated;
        │                                   invalid → leave null + log,
        ▼                                    never write garbage)
lead detail shows pending suggestions
        │
   ┌────┴─────┐
   ▼          ▼
 Approve    Dismiss
   │          │
   │          └──► clear ai_* / set suggestion_status='dismissed'
   │
   ├──► copy ai_summary    → summary
   ├──► copy ai_priority   → priority
   ├──► copy ai_next_action→ next_action
   ├──► suggestion_status  = 'approved'
   └──► INSERT activities row (kind='approve')
                │
                ▼
      lead now feeds NEXT ACTIONS ranking live
```

**Follow-up drafts:** AI drafts message text stored as an activity row
(`kind='draft'`, `status='pending'`). Human copies and sends manually in v1.

**Hard rule:** no code path from AI output to email without a human click. Any
future AgentMail send function must accept **only an approved suggestion id**,
re-verify `status` server-side, and never take raw to/body from the client.

**Live fields are never mutated by AI directly** — verify by DB inspection
(0056 acceptance).

## Secrets handling

| Secret | Where used | Rule |
|---|---|---|
| `NVIDIA_API_KEY` | `api/chat.js` (existing) | Vercel env only |
| `AGENTMAIL_API_KEY` | `api/_mail.js` (existing) | Vercel env only |
| `AGENTMAIL_INBOX_ID` | `api/_mail.js` (existing) | Vercel env, default `tiny-coder-2104@agentmail.to` |
| `SUPABASE_URL` | server fns + dashboard anon key | URL may be public; key discipline below |
| `SUPABASE_SERVICE_ROLE_KEY` | `api/` server fns only | **Never in client code** — grep the built/static output before every deploy (0059 negative test) |

Supabase anon key in the dashboard is fine (RLS gates the data). Service-role
key has no place in `app.js`, `/dashboard/` assets, or any static file.
