// lib/suggest.js — AI suggestions + follow-up drafts (ticket 0056).
// Shared by api/chat.js, api/leads.js (auto suggestions on create/stage
// change) and api/suggest.js (on-demand draft). Native https — Node 16, no npm.
//
// Contract (DATA_MODEL §Approval-gate data flow): this module only PRODUCES
// suggestion data. Live lead fields are written exclusively by the human
// approve click in dashboard/app.js. Invalid model output → null + log,
// never a partial write.

import https from 'https';
import { URL } from 'url';
import { readFileSync } from 'fs';

// Single source of the operator allowlist in JS (demo() asserts the literal
// appears in exactly one file). SQL side: is_admin() in migrations/0001_init.sql
// keeps its own literal — SQL can't import JS.
export const OPERATOR_EMAIL = 'tiny-coder-2104@agentmail.to';

const MODEL = 'meta/llama-3.2-11b-vision-instruct';
const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

function postJson(url, payload, key) {
  return new Promise((resolve, reject) => {
    if (!key) return reject(new Error('NVIDIA_API_KEY not set'));
    const u = new URL(url);
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      timeout: 25000, // NVIDIA observed 13-20s; 15000 still timed out at ~16.9s in prod
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let chunks = '';
      res.on('data', c => (chunks += c));
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('NVIDIA API timeout')); });
    req.write(data);
    req.end();
  });
}

// Hand-rolled validation: all four fields required together — a half-valid
// suggestion is dropped whole (DATA_MODEL: invalid → leave null + log).
export function validateSuggestion(raw) {
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const s = k => String(obj[k] ?? '').trim();
  const summary = s('summary');
  const priority = s('priority').toUpperCase();
  const priority_reason = s('priority_reason');
  const next_action = s('next_action');

  if (!summary || summary.length > 600) return null;
  if (!PRIORITIES.includes(priority)) return null;
  if (!priority_reason || priority_reason.length > 300) return null;
  if (!next_action || next_action.length > 200) return null;

  return { summary, priority, priority_reason, next_action };
}

// Follow-up draft: human tone, ≤500 chars, NO prices, NO commitments
// (CONCIERGE_SPEC hard rule — no binding quote ever comes from AI text).
export function validateDraft(raw) {
  const t = String(raw || '')
    .replace(/^```[a-z]*\n?|\n?```$/gi, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!t || t.length > 500) return null;
  if (/\$\s?\d/.test(t) || /\b\d+\s?(usd|php|eur)\b/i.test(t)) {
    console.warn('[suggest] draft contains a price — dropped');
    return null;
  }
  if (/\b(guarantee|guaranteed|i promise|promise to)\b/i.test(t)) {
    console.warn('[suggest] draft contains a commitment — dropped');
    return null;
  }
  return t;
}

// Pull the first JSON object out of model output (fences/prose tolerated).
function extractJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

// One NVIDIA call. Missing key / bad status / network error → null + warn
// (soft-degrade pattern from chat.js/leads.js — callers never break).
async function chatCompletion(messages, opts) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) {
    console.warn('[suggest] NVIDIA_API_KEY not set — skipping');
    return null;
  }
  let r;
  try {
    r = await postJson(ENDPOINT, {
      model: MODEL,
      messages,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature
    }, key);
  } catch (e) {
    console.warn('[suggest] nvidia error:', e.message);
    return null;
  }
  try {
    const json = JSON.parse(r.body);
    if (r.status !== 200 || !json.choices?.[0]?.message?.content) {
      console.warn('[suggest] nvidia bad response:', r.status);
      return null;
    }
    return json.choices[0].message.content;
  } catch {
    console.warn('[suggest] nvidia unparseable body');
    return null;
  }
}

const SYSTEM_SUGGEST = `You are a CRM assistant for a solo freelance AI-automation developer.
Given a lead, return ONLY compact JSON (no markdown, no prose):
{"summary":"<=600 chars: what this lead wants, in plain words","priority":"LOW or MEDIUM or HIGH","priority_reason":"<=300 chars: why that priority, shown to the human operator","next_action":"<=200 chars: the single next step"}
Priority guide: HIGH = clear project + timeline/urgency; MEDIUM = real project, soft timeline; LOW = vague or low-fit.
Never invent facts that are not in the lead.`;

const SYSTEM_DRAFT = `You draft a short follow-up message from a freelance developer to a lead.
Rules: under 500 characters, warm human tone, reference their specific problem, suggest one next step (reply or quick call).
NEVER mention prices, rates, quotes, guarantees, or any commitment — no promises of outcomes or deadlines.
Return ONLY the message text, nothing else.`;

function leadContext(lead) {
  return [
    'name: ' + (lead.name || ''),
    'business: ' + (lead.business_name || ''),
    'type: ' + (lead.type || ''),
    'problem: ' + (lead.problem || ''),
    'project: ' + (lead.project_description || ''),
    'budget: ' + (lead.budget || ''),
    'timeline: ' + (lead.timeline || ''),
    'stage: ' + (lead.stage || ''),
    'source: ' + (lead.source || '')
  ].join('\n');
}

// One lead → one validated suggestion object, or null (never partial).
export async function suggestForLead(lead) {
  const text = await chatCompletion(
    [{ role: 'system', content: SYSTEM_SUGGEST }, { role: 'user', content: leadContext(lead) }],
    { temperature: 0.3, max_tokens: 250 } // low temp = extraction reliability
  );
  if (!text) return null;
  const v = validateSuggestion(extractJson(text));
  if (!v) console.warn('[suggest] invalid suggestion output dropped:', text.slice(0, 200));
  return v;
}

// PATCH body for the leads row — always (re)arms the approval gate.
export const suggestionPatch = sug => ({
  ai_summary: sug.summary,
  ai_priority: sug.priority,
  ai_priority_reason: sug.priority_reason,
  ai_next_action: sug.next_action,
  suggestion_status: 'pending'
});

// One lead → one validated draft message, or null.
export async function draftForLead(lead) {
  const text = await chatCompletion(
    [{ role: 'system', content: SYSTEM_DRAFT }, { role: 'user', content: leadContext(lead) }],
    { temperature: 0.5, max_tokens: 300 }
  );
  if (!text) return null;
  const v = validateDraft(text);
  if (!v) console.warn('[suggest] invalid draft dropped:', text.slice(0, 200));
  return v;
}

// demo() self-check — offline: run from repo dir: node16 lib/suggest.js
if (typeof process !== 'undefined' && import.meta.url === 'file://' + process.argv[1]) {
  const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

  // validateSuggestion: good accepted, shape normalized
  const good = JSON.stringify({
    summary: 'Needs a booking site for Davao tour operators',
    priority: 'HIGH',
    priority_reason: 'Clear project, 2-week timeline',
    next_action: 'Send proposal draft'
  });
  const v = validateSuggestion(good);
  assert(v && v.summary.startsWith('Needs a booking'), 'good suggestion accepted');
  assert(v.priority === 'HIGH' && v.next_action === 'Send proposal draft', 'fields kept');
  assert(validateSuggestion(good.replace('"HIGH"', '"high"')).priority === 'HIGH', 'priority case normalized');

  // rejects: bad priority / oversize summary / missing next_action / junk
  assert(validateSuggestion(good.replace('"HIGH"', '"URGENT"')) === null, 'bad priority rejected');
  assert(validateSuggestion(JSON.stringify({
    summary: 'x'.repeat(601), priority: 'LOW', priority_reason: 'r', next_action: 'n'
  })) === null, 'oversize summary rejected');
  const missing = JSON.parse(good);
  delete missing.next_action;
  assert(validateSuggestion(JSON.stringify(missing)) === null, 'missing next_action rejected');
  assert(validateSuggestion('not json at all') === null, 'non-JSON rejected');
  const longAction = JSON.parse(good); longAction.next_action = 'y'.repeat(201);
  assert(validateSuggestion(JSON.stringify(longAction)) === null, 'oversize next_action rejected');

  // validateDraft: bounds + hard rules
  assert(validateDraft('Hi Ana — saw your note about the booking system. Free for a quick call Thursday?') !== null, 'good draft accepted');
  assert(validateDraft('x'.repeat(501)) === null, 'oversize draft rejected');
  assert(validateDraft('') === null, 'empty draft rejected');
  assert(validateDraft('This would run $200 for the first phase') === null, 'price in draft rejected');
  assert(validateDraft('I guarantee we will double your sales') === null, 'commitment in draft rejected');

  // suggestionPatch always re-arms the gate
  assert(suggestionPatch(v).suggestion_status === 'pending', 'patch resets status to pending');
  assert(suggestionPatch(v).ai_priority_reason === v.priority_reason, 'patch carries reason');

  // OPERATOR_EMAIL single-sourced: literal appears in exactly one JS file
  const files = ['lib/suggest.js', 'api/leads.js', 'api/suggest.js', 'api/chat.js', 'dashboard/app.js'];
  let hits = 0;
  for (const f of files) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    hits += src.split(OPERATOR_EMAIL).length - 1;
  }
  assert(hits === 1, 'OPERATOR_EMAIL literal in exactly one JS file (got ' + hits + ')');

  console.log('lib/suggest.js demo: all 16 checks passed.');
}
