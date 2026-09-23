// lib/kb.js — business facts, single source of truth (ticket 0055).
// Pure data ES module: no node APIs, no secrets. Safe to import from
// api/chat.js (server) AND app.js (browser) — Vercel serves repo root static.

export const SERVICES = [
  { name: 'AI Chatbots & Agents', detail: 'WhatsApp/Telegram/website chatbots, customer support, scheduling, FAQs' },
  { name: 'Workflow Automation', detail: 'n8n/Make/custom, connecting tools, automating repetitive tasks' },
  { name: 'Web Applications', detail: 'booking systems, dashboards, internal tools (React/Node.js/Supabase/Vercel)' },
  { name: 'Browser Automation', detail: 'web scraping, form filling, data collection, lead generation' },
  { name: 'Data Processing', detail: 'CSV/JSON processing, API integrations, automated reporting' }
];

export const SERVICE_NAMES = SERVICES.map(s => s.name);

export const PROCESS_STEPS = [
  { name: 'Discovery', detail: '1 call to understand your problem' },
  { name: 'Prototype', detail: '1–2 weeks to build a working version' },
  { name: 'Production', detail: 'deploy + handoff, your automation runs 24/7' }
];

export const PRICING = 'Project-based (₱15,000–₱150,000) or hourly (₱1,000–₱2,000/hr). Packages start at ₱25,000. Free consultation call available.';

export const PROJECTS = [
  '📊 DavaoBook — Booking Management System for Davao tourism operators',
  '🧰 TinyCoder Toolbox — PWA with 5 dev tools (offline-first)',
  '💬 AI Customer Support Agent — WhatsApp/website chatbot handling 80% of inquiries automatically'
];

export const HELP_ITEMS = [
  'Build AI chatbots that handle customer support 24/7',
  'Automate repetitive workflows so your team focuses on growth',
  'Create custom web apps (dashboards, booking, internal tools)',
  'Set up browser automation for scraping and data collection',
  'Process and analyze your data with automated reporting'
];

// Lobby FAQ pills — rendered locally in app.js, zero API cost.
export const FAQ = {
  services: `I'm a freelance AI-automation developer based in Davao City, Philippines. I build:\n\n${SERVICES.map(s => '• ' + s.name).join('\n')}`,
  projects: `Recent work includes:\n\n${PROJECTS.join('\n')}`,
  help: `I can help you:\n\n${HELP_ITEMS.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\nJust tell me what you need!`,
  pricing: `Pricing is project-based (₱15,000–₱150,000) or hourly (₱1,000–₱2,000/hr). Packages start at ₱25,000. I also offer a free consultation call to discuss your needs.\n\nProcess:\n${PROCESS_STEPS.map((p, i) => `${i + 1}. ${p.name} — ${p.detail}`).join('\n')}`
};

// KB facts for the server system prompt (assembled with behavioral rules in api/chat.js).
export const KB_TEXT = [
  'Services offered:',
  ...SERVICES.map(s => `- ${s.name}: ${s.detail}`),
  '',
  `Process: ${PROCESS_STEPS.map(p => `${p.name} (${p.detail})`).join(' → ')}`,
  '',
  `Pricing: ${PRICING}`,
  '',
  'Recent projects:',
  ...PROJECTS.map(p => `- ${p}`),
  '',
  'Capabilities:',
  ...HELP_ITEMS.map(h => `- ${h}`)
].join('\n');
