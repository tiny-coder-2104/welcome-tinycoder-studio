# Testing Pipeline — TinyCoder Business OS

Repeatable QA loop. Trigger → plan → execute → triage → fix → verify → report.

## Stages

1. **TRIGGER** — any code change, pre-release, or on-demand ("run the pipeline").
2. **PLAN** — QA writes/updates a test plan in `tests/plans/` (per-area, or `smoke.md`
   for a full-system pass). Plan = scope + expected results + evidence format.
3. **EXECUTE** — tester runs, in order:
   - `bash tests/run-all.sh` (local, 6 demo suites, ~10s)
   - curl E2E against deployed URL (401/503/405 paths, lead capture, RLS, secrets grep)
   - navigator browser checks (delegated: login, dashboard, approve/dismiss, static pages)
4. **TRIAGE** — QA reviews evidence, classifies each check PASS/FAIL/BLOCKED, files
   bug tickets via tk (`type=bug`, priority = severity, verbatim repro command).
5. **FIX** — dev-worker fixes (routed by Oracle). QA never fixes code.
6. **VERIFY** — QA re-runs the EXACT repro command from the ticket. Exit 0 → close.
   Non-zero → reopen with new output.
7. **REPORT** — QA logs to `qa.md` memory; Oracle reports to user.

## Rules

- Verification is always the ticket's own command — never a re-written test.
- Severity: Critical (blocks ship) / Major (human override) / Minor (7-day).
- No frameworks, no CI, no coverage tools. run-all.sh before push IS the CI.
- Test data only (fake PII). Browser checks against prod use disposable seeded leads.
- QA reads only `.secrets/supabase-<test-id>.env` (test env, once 0066 is set up).

## Artifacts

| What | Where |
|------|-------|
| Test plans | `tests/plans/*.md` |
| Run logs | `qa/logs/` |
| Screenshots | `qa/artifacts/` (navigator: `logs/navigator/YYYY-MM-DD-<flow>/`) |
| Bug tickets | tk (`type=bug`) |
| Memory | `.opencode/agents/memory/{qa,tester}.md` |

## Definition of Done (per ticket)

1. 6/6 demo suites green.
2. Acceptance criteria met with evidence.
3. RLS anon-zero on touched tables; secret grep clean.
4. No prod-data pollution.
5. Approval gate intact; no auto-send path.
6. Pushed, deployed, content-probed, ticket updated.