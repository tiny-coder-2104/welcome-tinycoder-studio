#!/usr/bin/env bash
# tests/run-all.sh — regression suite for TinyCoder Business OS.
# Runs all 6 demo() assert suites under node16. Exit 1 on any failure.
# Usage: bash tests/run-all.sh   (from repo root; node16 resolved inside)
# ponytail: no touched-file->suite mapping — run-all is ~10s, mapping pays off
# only if this ever exceeds ~1 min. Add it then, not now.
NODE=/home/yuki/.nvm/versions/node/v16.20.2/bin/node
cd "$(dirname "$0")/.."   # repo root — suites require repo-dir cwd
SUITES=(app.js dashboard/rank.js api/chat.js api/leads.js lib/suggest.js api/suggest.js)
FAIL=0
for s in "${SUITES[@]}"; do
  if $NODE "$s" >/tmp/tc-test.log 2>&1; then
    echo "PASS  $s"
  else
    echo "FAIL  $s"
    tail -3 /tmp/tc-test.log
    FAIL=1
  fi
done
[ $FAIL -eq 0 ] && echo "ALL SUITES GREEN" || echo "SUITE FAILURES PRESENT"
exit $FAIL