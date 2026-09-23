# Smoke test plan — TinyCoder Business OS (full-system, one pass)

Run order: Local → Live API → Browser. All checks runnable by tester (bash + curl + navigator). Fake PII only. `U=https://welcome-tinycoder-studio.vercel.app`

## 1. Local — 6 demo suites
- `bash tests/run-all.sh` (repo root, node16) → expect `ALL SUITES GREEN`, exit 0.

## 2. Live API E2E (curl, deployed)
- **Static pages 200** — `for p in index.html intake.html contact.html what-we-do.html pricing-faq.html; do curl -s -o /dev/null -w "$p:%{http_code} "; done` → 200 ×5.
- **Secrets grep** — `for u in $U/ $U/intake.html $U/contact.html $U/what-we-do.html $U/pricing-faq.html $U/app.js $U/style.css; do curl -s $u; done | grep -cE 'SUPABASE_SERVICE_ROLE_KEY|NVIDIA_API_KEY|AGENTMAIL_API_KEY'` → 0.
- **RLS anon** — `curl -s -w "\n%{http_code}" "$SUPABASE_URL/rest/v1/leads?select=id&limit=1" -H "apikey: $SUPABASE_ANON_KEY"` → 200 + `[]` (deny-by-absence) or 401/403 — record actual. (Supabase REST is NOT exposed on the Vercel domain — hit Supabase directly; anon key from client bundle or test env.)
- **Lead capture (intake branch)** — `curl -s -X POST $U/api/chat -H 'Content-Type: application/json' -d '{"lead":{"name":"Smoke Test","email":"smoke-<ts>@example.com","type":"Web Applications","problem":"Smoke test booking system for a resort"}}'` → 200, JSON has `leadId` + text contains `1 business day`. Verify row: `curl -s "$SUPABASE_URL/rest/v1/leads?id=eq.<leadId>&select=source,stage,priority" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"` → `source=CONCIERGE, stage=NEW, priority=MEDIUM` (fallback: navigator dashboard lead detail).
- **Contact branch** — `curl -s -X POST $U/api/chat -H 'Content-Type: application/json' -d '{"contact":{"name":"Smoke Test","email":"smoke-<ts>@example.com","message":"Do you build WhatsApp bots for small resorts? Need pricing info please."}}'` → 200 + `leadId`; row check → `type='General Inquiry'`, `problem` starts with `[contact] `.
- **Rate limiter** — `for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}\n" -X POST $U/api/chat -H 'Content-Type: application/json' -d '{}'; done` → 429 fires at least once (serverless instance splitting makes the exact 10/1 split nondeterministic — assert "429 fires", not the split). (Empty body 400s after the rate-limit check — no leads, no NVIDIA calls. Risk: serverless instances may split the burst → 429 may not fire; retry once with `--keepalive` or mark BLOCKED.)
- **Unauth /api/leads** — `curl -s -w "\n%{http_code}" -X POST $U/api/leads -H 'Content-Type: application/json' -d '{"name":"x"}'` → 401 `{"error":"unauthorized"}`.

## 3. Browser (navigator, prod)
1. Landing: `#option-menu` renders 5 pills (Start a project, What we do, Pricing & FAQ, Contact us, Talk to a concierge).
2. Chat hidden by default — no chat widget visible on load; opens after menu selection.
3. Hero: no text/pill overlap at 1280×800 (screenshot).
4. Dashboard: anon visit to /dashboard → login wall (magic-link form), no lead data visible.

## 4. Evidence format (per check)
- Local: exit code + last line of run-all output.
- API: HTTP code + body snippet (first 200 chars) + leadId where present.
- RLS/row checks: HTTP code + full body.
- Browser: screenshot path (`logs/navigator/YYYY-MM-DD-<flow>/`) + one-line DOM observation per check.
- All evidence logged to `qa/logs/`; failures → bug ticket via tk with the verbatim command.

## Not covered (explicit)
- Approval gate approve/dismiss, stage transitions, magic-link login, AI suggestions — plans/{suggestions,dashboard}.md, not smoke.
- 50/hr rate limit (40 min of requests — smoke tests 10/min only).
- Test-env isolation (0066 pending) — E2E runs against prod with disposable fake leads.