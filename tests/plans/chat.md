# Chat / concierge test plan

## Suite: api/chat.js — run: bash tests/run-all.sh
## E2E (deployed): intake branch → leadId in ~4s (0 NVIDIA); contact branch → type='General Inquiry', source CONCIERGE, [contact] prefix
## Browser (navigator): menu → chat opens; chat hidden by default on landing
## Edge cases: rate limiter (10/min, 50/hr), invalid lead rejected, seedTags keyword seeding (booking/chatbot/website/automation/data)