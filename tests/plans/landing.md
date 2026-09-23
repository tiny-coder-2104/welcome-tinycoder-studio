# Landing / static pages test plan

## Suite: app.js (client bundle) — run: bash tests/run-all.sh
## E2E (deployed): index.html, intake.html, contact.html, what-we-do.html, pricing-faq.html → 200, 0 JS errors
## Browser (navigator): #option-menu 5 pills render, hero no overlap, chat hidden by default
## Edge cases: secret grep clean (no service-role/NVIDIA/agentmail keys in client output), PHP pricing everywhere