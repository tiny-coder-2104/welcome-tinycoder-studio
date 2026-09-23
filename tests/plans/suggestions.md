# Suggestions test plan

## Suite: lib/suggest.js + api/suggest.js — run: bash tests/run-all.sh
## E2E (deployed): action:'suggest' with operator JWT → suggestion row; draft validator rejects prices/commitments
## Browser (navigator): dashboard lead detail shows suggestion card + Approve/Dismiss; approve copies ai_* → live fields
## Edge cases: JWT + operator-email verified, whitelisted body, 25000 timeout, failed-state hint