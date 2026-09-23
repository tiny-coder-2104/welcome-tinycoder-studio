# AUDIT.md — TinyCoder Studio Virtual Office (as of 2026-09-23)

Existing-system audit ahead of Business OS build-out. Every claim below is
line-verified against the code in this repo.

## Snapshot

One-page static site + two Vercel serverless functions. No framework, no build
step, no database, no auth, no test framework. Owner-facing "Business OS"
(dashboard, leads, AI suggestions) does not exist yet — tickets 0053–0059 add it.

```
Browser (lobby)
  │  FAQ pill ──► local FAQ object in app.js (no API call)
  │  free chat ─► POST /api/chat ─► NVIDIA llama-3.2-11b
  │                 reply may end with __ORDER__ {json}
  │                 ▼ parsed CLIENT-side (app.js)
  │              confirm panel ──► POST /api/order ─► AgentMail email
  ▼
Vercel serves repo root as static files (index.html, app.js, style.css, assets)
```

## Framework / build

- **None.** `package.json` is a single line: `{name, version, private, type:"module"}` — no
  dependencies, no scripts.
- Vanilla ES modules: `index.html` loads `<script type="module" src="/app.js">`, one
  `<link rel="stylesheet" href="/style.css">`.
- **README drift:** README says `npm run dev`, but there is no `dev` script (or any
  script). README references `vercel.json`, but it was deleted in commit `66217ca`
  (Vercel auto-detects Node). README calls this a "PWA", but there is no
  `manifest.json` and no service worker.

## Serving / routes

Static root serving — Vercel serves the repo root directly. No `public/`, no `dist/`.

| Route | File | Notes |
|---|---|---|
| `GET /` | `index.html` | Lobby: header, hero, chat panel, FAQ pills, footer |
| `GET /style.css` | `style.css` | All styles (site + chat + order panel) |
| `GET /app.js` | `app.js` | Chat client, FAQ, `__ORDER__` parse, order panel |
| `POST /api/chat` | `api/chat.js` | NVIDIA completions proxy + prompt + rate limit |
| `POST /api/order` | `api/order.js` | Order validation → AgentMail |
| assets | `office_background.jpeg`, `concierge.webp`, `kitten-strip.png` | Served from root |

## Components (UI)

- **Lobby** — full-viewport `office_background.jpeg` + cream gradient overlay
  (`.lobby`, `.lobby-bg`).
- **Concierge** — `concierge.webp` (133 KB, q80 alpha), 460 px desktop / 280 px
  mobile, feather mask (feet dissolve), floor shadow, 4 s `breathe` animation.
- **Kitten sprite** — `kitten-strip.png`, 8-frame CSS `steps(8)` walk cycle
  (`.kitten`, `--fw: 110px` desktop / `80px` mobile), 14 s traverse.
- **Chat panel** — glass (`rgba(255,248,240,0.82)` + blur), 510 px, `glowPulse`;
  header, scrollable body, FAQ pills row, input form.
- **FAQ pills** — 4 buttons (`services`, `projects`, `help`, `pricing`) answered
  **locally** from the static `FAQ` object in `app.js` — no API call.
- **Order panel** — rendered inline in the chat body after `__ORDER__` detection.

## Concierge implementation (`__ORDER__` marker pattern)

1. `api/chat.js` `SYSTEM` prompt embeds all business facts (services, process,
   pricing `₱15,000–₱150,000` project / `₱1,000–₱2,000/hr` hourly) and instructs the model:
   once name + email + project type + description are all collected, append
   exactly one line: `__ORDER__ {"name":...,"email":...,"type":...,"details":...}`.
   The model **collects** the marker in its output; it is not sent as structured data.
2. `app.js` `send()` matches `data.text.match(/__ORDER__\s*(\{[\s\S]*\})/)`,
   `JSON.parse`s it, strips the marker from the rendered reply, and calls
   `renderOrder(order)` → confirm panel with Name / Email / Type / Details +
   "Send Order Request" button.
3. Button click → `POST /api/order` with the parsed order object.
4. `api/order.js` validates (trim to 500, all four fields present, email regex),
   then `api/_mail.js` `sendOrder()` → AgentMail
   `POST /v0/inboxes/{inbox}/messages/send` → email to owner inbox.

**Parsing is CLIENT-side today.** Ticket 0055 (Phase 4) moves marker parsing
server-side into `api/chat.js`: strip before returning text to client, validate,
insert lead via service-role, return cleaned text + leadId; invalid → log + drop.

## APIs

### `api/chat.js` — NVIDIA LLM proxy

- Model `meta/llama-3.2-11b-vision-instruct` at
  `https://integrate.api.nvidia.com/v1/chat/completions`, `max_tokens: 350`,
  `temperature: 0.65`, 8 s HTTPS timeout, `NVIDIA_API_KEY` bearer auth.
- **In-memory IP rate limit** (`Map`, per-instance): 10 req/min + 50 req/hr per
  `x-forwarded-for`. Over limit → 429 with friendly text. Marked
  `ponytail: global rate limit, replace with Redis if multi-instance`.
- **Abuse blocklist** on last message: `ignore previous instructions`,
  `system prompt`, `jailbreak`, `/\bdan\b/i`, `developer mode`, `reveal your`,
  `prompt injection` → returns a friendly redirect (200, no model call).
- Message hygiene: array required, coerced to last 8 messages, role forced to
  user/assistant, content sliced to 1200 chars (long history truncated, not
  rejected — see stale demo below).
- Errors returned as `{text}` friendly strings for 400/429/502/503 so the client
  can show them directly.

### `api/order.js` + `api/_mail.js` — order → email

- `order.js`: method check, JSON body tolerate string, per-field trim/slice 500,
  all-four-required, email regex, `AGENTMAIL_API_KEY` presence (503 if unset),
  send failure → 502.
- `_mail.js`: native `https` only, inbox defaults to
  `tiny-coder-2104@agentmail.to`, subject "New portfolio order request".

### `api/chat.js` client contract

Client sends `{messages: history.slice(-8)}`, 10 s `AbortController` timeout;
server also truncates. Double truncation is intentional (client UX + server safety).

## Tests

**No test framework.** Inline `demo()` asserts in `app.js` and `api/chat.js`,
gated by `import.meta.url === \`file://${process.argv[1]}\``. Verified today:

- `node api/chat.js` → **FAILS**: `FAIL: 2001 char should fail`.
  `validateMessages()` was changed to "truncate oversize instead of rejecting"
  (commit `3569a60`) but the asserts still expect the old reject behavior.
  **Stale — asserts must be updated to match truncation semantics.**
- `node app.js` → **cannot run**: top-level `document.getElementById(...)` throws
  `ReferenceError: document is not defined` before the demo guard is reached.
  **Demo is unreachable outside the browser.**

`app.js` demo asserts (`esc`, FAQ contents) are otherwise sound.

## Deployment / secrets

- Vercel auto-deploy on push to `main` (`tiny-coder-2104/welcome-tinycoder-studio`).
  No `vercel.json` (removed); Vercel auto-detects Node. Push = live deploy —
  human approval required before pushing.
- Env secrets (Vercel Dashboard → Project → Settings → Environment Variables):
  - `NVIDIA_API_KEY` — NVIDIA completions (chat).
  - `AGENTMAIL_API_KEY` — AgentMail send (order).
  - `AGENTMAIL_INBOX_ID` — inbox id, default `tiny-coder-2104@agentmail.to`.
  - *(Phase 2 adds `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — service-role
    key never in client code.)*
- Node 16 for local `api/` runs (native `https`, zero deps).

## DB / auth status

**None.** No Supabase, no migrations, no `migrations/` dir, no auth, no
`/dashboard/`. Leads, activities, tasks, RLS, magic-link — all future work
(tickets 0053–0059). See `docs/DATA_MODEL.md` and `docs/ROADMAP.md`.

## Known gaps to fix during Business OS phases

| Gap | Where | Ticket |
|---|---|---|
| `__ORDER__` parsed client-side | `app.js` | 0055 |
| Business facts inline in SYSTEM prompt (not a KB module) | `api/chat.js` | 0055 |
| Stale `demo()` asserts in `chat.js` | `api/chat.js` | — (fix with 0055) |
| `app.js` demo unreachable under node | `app.js` | — (browser-only, accept) |
| README: missing `dev` script, dead `vercel.json`, "PWA" w/ no manifest | `README.md` | — (docs only, out of 0052 scope) |
| No DB / auth / dashboard | — | 0053–0056 |
