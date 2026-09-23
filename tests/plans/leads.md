# Leads test plan

## Suite: api/leads.js (7 checks) — run: bash tests/run-all.sh
## E2E (deployed, manual): curl -X POST https://<url>/api/leads ... → expect 401/503
## Browser (navigator): dashboard lead list renders after login
## Edge cases: bad token before validation, enum fallback, 503 no-env