# Dashboard test plan

## Suite: dashboard/app.js + dashboard/rank.js — run: bash tests/run-all.sh
## E2E (deployed): magic-link login → pipeline renders; tag filter; stage transitions obey TRANSITIONS map
## Browser (navigator): login flow, lead detail, tag edit (comma → array), approve/dismiss on disposable seeded lead only
## Edge cases: invalid transition rejected, RLS anon-zero (browser-level: fresh context shows login wall)