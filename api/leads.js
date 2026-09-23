// api/leads.js — dashboard mutations that need the service-role key (0054.6).
//   POST  /api/leads — manual lead create (+ activity kind='create')
//   PATCH /api/leads — stage change  (+ activity kind='stage_change')
//
// Why server-side: leads has NO authenticated INSERT policy and activities
// INSERT is service-role-only (DATA_MODEL.md). Stage change also enforces the
// PIPELINE_SPEC transition map (shared with dashboard via ../dashboard/rank.js
// — server re-checks, client map is display-only).
//
// Auth: caller's magic-link access token, verified against GoTrue /auth/v1/user;
// email must match is_admin() allowlist. Session ≠ data: even here, a non-
// operator token gets 401. No env → 503 'not configured' (order.js pattern).
// Uses https module — Node 16 has no global fetch (house constraint).
import https from 'https';
import { URL } from 'url';
import { STAGES, TRANSITIONS } from '../dashboard/rank.js';
import { OPERATOR_EMAIL } from '../lib/suggest.js';

// OPERATOR_EMAIL is single-sourced in lib/suggest.js (0056; demo() greps it) —
// keep that literal in sync with is_admin() in migrations/0001_init.sql.
const SOURCE_OK = ['CONCIERGE', 'MANUAL', 'OUTREACH'];
const PRIORITY_OK = ['LOW', 'MEDIUM', 'HIGH'];

const clean = (s, n = 500) => String(s || '').trim().slice(0, n);

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method,
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    }, res => {
      let chunks = '';
      res.on('data', c => (chunks += c));
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

// exported for api/suggest.js (0056) — same GoTrue check, one implementation
export async function verifyAdmin(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    const r = await request(process.env.SUPABASE_URL + '/auth/v1/user', {
      headers: {
        Authorization: 'Bearer ' + token,
        apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    });
    if (r.status !== 200) return false;
    return String(JSON.parse(r.body).email || '').toLowerCase() === OPERATOR_EMAIL;
  } catch { return false; }
}

// exported for api/suggest.js (0056)
export async function sb(path, opts = {}) {
  const r = await request(process.env.SUPABASE_URL + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      ...(opts.rep ? { Prefer: 'return=representation' } : {})
    },
    body: opts.body
  });
  if (r.status >= 300) {
    console.error('supabase', r.status, r.body.slice(0, 300));
    throw new Error('supabase ' + r.status);
  }
  return r.body ? JSON.parse(r.body) : null;
}

// Sanitize + default (order.js style). Unknown enum values fall back to the
// column default rather than 400 — form selects constrain the UI anyway, and
// the DB CHECKs are the real boundary.
function pickLead(body) {
  const stage = String(body.stage || 'NEW').toUpperCase();
  const priority = String(body.priority || 'MEDIUM').toUpperCase();
  const source = String(body.source || 'MANUAL').toUpperCase();
  return {
    name: clean(body.name),
    email: clean(body.email) || null,
    phone: clean(body.phone) || null,
    business_name: clean(body.business_name) || null,
    type: clean(body.type) || null,
    problem: clean(body.problem, 2000) || null,
    project_description: clean(body.project_description, 5000) || null,
    budget: clean(body.budget) || null,
    timeline: clean(body.timeline) || null,
    source: SOURCE_OK.includes(source) ? source : 'MANUAL',
    stage: STAGES.includes(stage) ? stage : 'NEW',
    priority: PRIORITY_OK.includes(priority) ? priority : 'MEDIUM'
  };
}

async function createLead(res, body) {
  const lead = pickLead(body);
  if (!lead.name) return res.status(400).json({ error: 'name is required' });
  // dedupe on email (PIPELINE_SPEC §5) — same email → 409 + existing id
  if (lead.email) {
    const dup = await sb('leads?select=id&email=eq.' + encodeURIComponent(lead.email) + '&limit=1');
    if (dup.length) return res.status(409).json({ error: 'duplicate email', id: dup[0].id });
  }
  const rows = await sb('leads', { method: 'POST', body: lead, rep: true });
  const id = rows[0].id;
  await sb('activities', {
    method: 'POST',
    body: { lead_id: id, kind: 'create', body: 'manual create (source=' + lead.source + ')' }
  });
  // AI suggestions generated on-demand by /api/suggest when the lead is
  // opened (0056 rev: Vercel freezes post-response background tasks).
  res.json({ id });
}

async function changeStage(res, body) {
  const id = clean(body.id, 100);
  const to = String(body.stage || '').toUpperCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'id required' });
  }
  if (!STAGES.includes(to)) return res.status(400).json({ error: 'invalid stage' });

  const cur = await sb('leads?select=id,stage,name,business_name,type,problem,project_description,budget,timeline,source&id=eq.' + id + '&limit=1');
  if (!cur.length) return res.status(404).json({ error: 'not found' });
  const from = cur[0].stage;
  if (from === to) return res.json({ ok: true, stage: to, changed: false });
  if (!TRANSITIONS[from] || !TRANSITIONS[from].includes(to)) {
    return res.status(400).json({ error: 'invalid transition ' + from + ' → ' + to });
  }

  await sb('leads?id=eq.' + id, { method: 'PATCH', body: { stage: to } });
  await sb('activities', {
    method: 'POST',
    body: { lead_id: id, kind: 'stage_change', body: from + ' → ' + to }
  });
  // Suggestions stay on-demand (/api/suggest on lead open) — no auto re-fire.
  res.json({ ok: true, stage: to, changed: true });
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'PATCH') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'not configured' });
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  try {
    if (!(await verifyAdmin(req))) return res.status(401).json({ error: 'unauthorized' });
    if (req.method === 'POST') return await createLead(res, body || {});
    return await changeStage(res, body || {});
  } catch (e) {
    console.error('api/leads:', e.message);
    return res.status(502).json({ error: 'upstream failed' });
  }
}

// demo() self-check — offline: run from repo dir: node16 api/leads.js
if (typeof process !== 'undefined' && import.meta.url === 'file://' + process.argv[1]) {
  const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
  const mkRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = c => { r.statusCode = c; return r; };
    r.json = j => { r.body = j; return r; };
    return r;
  };
  const run = async req => { const res = mkRes(); await handler(req, res); return res; };

  const hadUrl = process.env.SUPABASE_URL;
  const hadKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  (async () => {
    // ticket 0054 verify: manual create returns 503 without env
    let res = await run({ method: 'POST', headers: {}, body: { name: 'x' } });
    assert(res.statusCode === 503 && res.body.error === 'not configured', 'no env → 503, got ' + res.statusCode);

    res = await run({ method: 'GET', headers: {} });
    assert(res.statusCode === 405, 'GET → 405, got ' + res.statusCode);

    // env present, no bearer → 401 before any network
    process.env.SUPABASE_URL = hadUrl || 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = hadKey || 'dummy_service_key_not_real';
    res = await run({ method: 'POST', headers: {}, body: { name: 'x' } });
    assert(res.statusCode === 401, 'no bearer → 401, got ' + res.statusCode);

    res = await run({ method: 'POST', headers: { authorization: 'Bearer nope' }, body: { name: '' } });
    assert(res.statusCode === 401, 'bad token → 401 before validation, got ' + res.statusCode);

    // enum fallbacks + required name
    const p = pickLead({ name: 'A', source: 'bogus', priority: 'bogus', stage: 'bogus' });
    assert(p.source === 'MANUAL' && p.priority === 'MEDIUM' && p.stage === 'NEW', 'invalid enums fall back to defaults');
    assert(pickLead({}).name === '', 'missing name stays empty');
    assert(clean('  hi  ') === 'hi', 'clean trims');

    if (!hadUrl) delete process.env.SUPABASE_URL;
    if (!hadKey) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    console.log('api/leads.js demo: all 7 checks passed.');
  })().catch(e => { console.error(e.message); process.exit(1); });
}
