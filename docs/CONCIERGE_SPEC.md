# CONCIERGE_SPEC.md — Concierge: answer, intent, qualify, capture

The revenue path: real conversations → validated lead rows → dashboard. Grounded
in tickets 0055 (capture) and 0052 (rulings).

## Four paths

```
visitor message
   │
   ├─ abuse hit / rate limited ──► friendly static reply (existing chat.js behavior)
   │
   ├─ ANSWER ──► KB-grounded reply (services, process, pricing, FAQ)
   │
   ├─ INTENT: POTENTIAL_CLIENT? ── no  ──► answer only, no lead payload accepted
   │              │ yes
   │              ▼
   └─ QUALIFY ──► progressive questions ──► __ORDER__ marker ──► SERVER parse
                                                       │
                                                       ▼
                                              leads row (service-role INSERT)
                                                       │
                                                       ▼
                                         ai_* suggestions generated (pending)
                                                       │
                                                       ▼
                                         dashboard NEXT ACTIONS picks it up
```

## 1. Answer

Replies are grounded in the KB module (`lib/kb.js` or `api/kb/` static files —
business facts extracted **out** of the system prompt). Runtime prompt = KB text +
behavioral instructions. No KB table, no KB admin UI.

**KB is the source of truth. Hard rules:**

- Never invent capabilities, prices, clients, or testimonials.
- If the KB does not cover it, say so and offer the consultation call — do not
  improvise numbers or names.
- Keep replies short (<100 words), friendly. (Existing behavior, kept.)

## 2. Intent classification

Lightweight, server-side, before any lead payload is accepted:

- Gate: `POTENTIAL_CLIENT` — visitor is describing a real project (has a problem,
  wants something built, asks to start/hire/order).
- Reuse the existing rate limiter (10/min, 50/hr per IP) and abuse blocklist —
  no new machinery.
- Not a client → answer path only; a marker in a non-client conversation is
  dropped (log, no insert).

**AI never makes high-impact decisions**: no stage jumps to WON/LOST, no binding
quotes, no sending anything on the visitor's behalf.

## 3. Conversational qualification — "I have a project"

Prominent lobby pill/button → conversation starts. **Progressive: one topic at a
time, never a form dump.** Order per spec §9 / ticket 0055:

1. **What to build** — infer project `type` from what they say (existing
   inference rules in `chat.js` SYSTEM kept: "WhatsApp bot" → AI Chatbots, etc.).
2. **Problem** — what's broken or missing.
3. **Existing system** — anything in place today.
4. **Timeline** — when they need it.
5. **Contact** — name, email, phone (optional), business name.
   Budget collected if volunteered; never pressed hard.

Never ask twice for something already given. Any feature/scope/use-case
description counts as `project_description`.

## 4. Confirmation (spec §9)

After all required fields are collected, the concierge replies with a short
confirmation summarizing what it heard — **then** the marker:

```
Got it — here's what I have: <type> for <business/name>, problem: <problem>,
timeline: <timeline>. Confirm and I'll pass this to the team.
__ORDER__ {"name":...,"email":...,"phone":...,"business_name":...,"type":...,
           "problem":...,"project_description":...,"budget":...,"timeline":...,
           "source":"CONCIERGE","stage":"NEW"}
```

Visitor can correct anything in chat before the lead is written (re-ask only the
corrected field).

## 5. Server-side marker parse + lead creation

All in `api/chat.js` (client never parses the marker again):

1. Strip `__ORDER__ {...}` from the reply text before returning to the client.
2. Validate: JSON parses; required fields present and non-empty after trim
   (order.js-style cleaning); email format; `type` in the five services; stage
   constrained to the 7-value set; `source='CONCIERGE'`.
3. **Hallucination guard:** only non-empty, user-given values are accepted —
   compare against chat history server-side where feasible; otherwise the value
   is left null and the summary is flagged for human review.
4. INSERT via service-role → `leads`. Return cleaned text + `leadId`.
5. **Invalid / malformed marker → log + drop.** No user-facing error, no partial
   write.
6. Duplicate email → handled per `PIPELINE_SPEC` dedupe (existing lead updated /
   flagged, not a second row).

**Order-email path choice:** keep `/api/order` untouched day-1 (smallest diff,
existing confirm-panel flow keeps working). Fold AgentMail email delivery into the
lead flow later once the lead path is stable.

**Abandoned conversation (no email):** lead is still creatable as contact-later —
`email` nullable, `stage='NEW'`. Flagged for confirmation in ticket 0059 path
testing.

## 6. Next-action suggestion

On successful lead insert, server generates `ai_summary` (§11 format),
`ai_priority` (+ visible reasons), `ai_next_action` — all
`suggestion_status='pending'`. Human approves on the lead detail page before they
become live fields. See `DATA_MODEL.md` for the gate flow.

## 7. FAQ pills (unchanged)

The 4 lobby pills answer **locally** from the static `FAQ` object in `app.js` —
no API call. Keep them; they are the zero-cost fast path. Long-term the FAQ
content should drift from the KB (single source of truth) — not blocking.
