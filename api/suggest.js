// api/suggest.js — on-demand AI suggestion + follow-up draft (ticket 0056).
// POST {action:'suggest'|'draft', lead_id} — lead_id only, NEVER free-text
// to/body/subject (admin hard rule: no path from client raw text toward
// outbound; drafts are stored for human copy/send, never sent — no auto-send
// path exists anywhere). 'suggest' generates ai_* + returns them; 'draft'
// stores a draft activity row.
// Auth: caller's GoTrue access token → /auth/v1/user must resolve to
// OPERATOR_EMAIL (single-sourced in lib/suggest.js). The service-role key
// lives here, so no public path. Session ≠ data: non-operator → 401.
// Uses https module — Node 16 has no global fetch (house constraint).
import { draftForLead, suggestForLead, suggestionPatch } from '../lib/suggest.js';
import { verifyAdmin, sb } from './leads.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'not configured' });
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // Shape gate first (pure, offline-testable): only {action, lead_id}.
  if (Object.keys(body).some(k => k !== 'action' && k !== 'lead_id')) {
    return res.status(400).json({ error: 'only {action, lead_id} accepted' });
  }
  if (body.action !== 'draft' && body.action !== 'suggest') {
    return res.status(400).json({ error: 'action must be "draft" or "suggest"' });
  }
  const id = String(body.lead_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'lead_id required' });
  }

  try {
    if (!(await verifyAdmin(req))) return res.status(401).json({ error: 'unauthorized' });
    const rows = await sb('leads?select=*&id=eq.' + id + '&limit=1');
    if (!rows.length) return res.status(404).json({ error: 'not found' });

    if (body.action === 'suggest') {
      const sug = await suggestForLead(rows[0]);
      if (!sug) return res.status(502).json({ error: 'suggestion generation failed' });
      await sb('leads?id=eq.' + id, { method: 'PATCH', body: suggestionPatch(sug) });
      return res.json({ ok: true, suggestion: sug });
    }

    const draft = await draftForLead(rows[0]);
    if (!draft) return res.status(502).json({ error: 'draft generation failed' });
    await sb('activities', {
      method: 'POST',
      body: { lead_id: id, kind: 'draft', draft_body: draft, status: 'pending' }
    });
    res.json({ ok: true, draft });
  } catch (e) {
    console.error('api/suggest:', e.message);
    return res.status(502).json({ error: 'upstream failed' });
  }
}

// demo() self-check — offline: run from repo dir: node16 api/suggest.js
if (typeof process !== 'undefined' && import.meta.url === 'file://' + process.argv[1]) {
  const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
  const mkRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = c => { r.statusCode = c; return r; };
    r.json = j => { r.body = j; return r; };
    return r;
  };
  const run = async req => { const res = mkRes(); await handler(req, res); return res; };
  const VALID_ID = '11111111-2222-3333-4444-555555555555';

  const hadUrl = process.env.SUPABASE_URL;
  const hadKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  (async () => {
    // no env → 503; GET → 405 (env checked after method)
    let res = await run({ method: 'POST', headers: {}, body: { action: 'draft', lead_id: VALID_ID } });
    assert(res.statusCode === 503 && res.body.error === 'not configured', 'no env → 503, got ' + res.statusCode);
    res = await run({ method: 'GET', headers: {} });
    assert(res.statusCode === 405, 'GET → 405, got ' + res.statusCode);

    process.env.SUPABASE_URL = hadUrl || 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = hadKey || 'dummy_service_key_not_real';

    // shape gate (before auth — pure checks, no network)
    res = await run({ method: 'POST', headers: {}, body: { action: 'draft', lead_id: VALID_ID, to: 'x@y.z' } });
    assert(res.statusCode === 400 && /only/.test(res.body.error), 'free-text key → 400, got ' + res.statusCode);
    res = await run({ method: 'POST', headers: {}, body: { action: 'send', lead_id: VALID_ID } });
    assert(res.statusCode === 400, 'non-draft action → 400, got ' + res.statusCode);
    // suggest passes the shape/action gate and reaches auth (401, no bearer)
    res = await run({ method: 'POST', headers: {}, body: { action: 'suggest', lead_id: VALID_ID } });
    assert(res.statusCode === 401, 'suggest w/o bearer → 401, got ' + res.statusCode);
    res = await run({ method: 'POST', headers: {}, body: { action: 'draft', lead_id: 'nope' } });
    assert(res.statusCode === 400 && res.body.error === 'lead_id required', 'bad lead_id → 400, got ' + res.statusCode);

    // valid shape, no bearer → 401 before any network
    res = await run({ method: 'POST', headers: {}, body: { action: 'draft', lead_id: VALID_ID } });
    assert(res.statusCode === 401, 'no bearer → 401, got ' + res.statusCode);

    if (!hadUrl) delete process.env.SUPABASE_URL;
    if (!hadKey) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    console.log('api/suggest.js demo: all 7 checks passed.');
  })().catch(e => { console.error(e.message); process.exit(1); });
}
