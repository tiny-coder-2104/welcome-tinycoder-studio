// dashboard/app.js — TinyCoder Business OS dashboard shell (ticket 0054).
// Vanilla ES modules, no build step, no framework. Public site untouched.
//
// Reads: anon (publishable) key + PostgREST + RLS session — the key below is
// public by design, RLS is the real gate. NEVER add the service-role key here
// (0059 negative test greps dashboard/ for the secret-key prefix).
// Writes: live-field edits → PostgREST PATCH (authenticated UPDATE policy);
// create + stage change → /api/leads (service-role; writes activity auto-row).
//
// Auth: hand-rolled GoTrue REST (~90 lines below) instead of CDN
// @supabase/supabase-js — session needs are send-link / parse-hash / refresh /
// Bearer header only; a CDN ESM dep for that is heavier than the code it
// replaces (house style: no build step, no npm). Unauthenticated or
// non-allowlisted session → queries return 0 rows (RLS) → empty states.
// Upgrade path: switch to supabase-js if session logic grows (MFA, providers).

import { rankActions, STAGES, TRANSITIONS } from './rank.js';

const SUPA = 'https://yndnlvrclfwnkqoqxpgv.supabase.co';
const ANON = 'sb_publishable_tc0lH6Dz8xBjDfhwrxGlIQ_eBC0k3gJ'; // public by design (RLS)
const LS = 'bos_session';

const TYPES = ['AI Chatbots & Agents', 'Workflow Automation', 'Web Applications', 'Browser Automation', 'Data Processing'];
const SOURCES = ['CONCIERGE', 'MANUAL', 'OUTREACH'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const LEAD_COLS = 'id,name,email,phone,business_name,type,problem,project_description,budget,timeline,source,stage,priority,summary,next_action,notes,ai_summary,ai_priority,ai_priority_reason,ai_next_action,suggestion_status,problem_tags,manual_today,created_at,updated_at';
// fields the detail form PATCHes directly (stage is NOT here — it goes through
// /api/leads for transition check + activity row; ai_* never — 0056 gate)
const EDIT_KEYS = ['name', 'email', 'phone', 'business_name', 'type', 'problem', 'project_description', 'budget', 'timeline', 'source', 'priority', 'summary', 'next_action', 'notes'];

let session = null;
let data = { leads: [], tasks: [] };
let loginError = '';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── auth: hand-rolled GoTrue REST (~90 lines) ─────────────────────────── */

function saveSession(s) {
  if (s) localStorage.setItem(LS, JSON.stringify(s));
  else localStorage.removeItem(LS);
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; }
}

// Magic-link redirect lands back here with tokens in the URL hash (implicit
// flow — no PKCE code exchange needed without supabase-js). Also catches
// GoTrue error redirects (#error=...&error_description=...).
function sessionFromHash() {
  const h = location.hash.slice(1);
  if (!h || (!h.includes('access_token') && !h.includes('error'))) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error')) {
    return { error: decodeURIComponent(p.get('error_description') || p.get('error')) };
  }
  if (!p.get('access_token')) return null;
  const s = {
    access_token: p.get('access_token'),
    refresh_token: p.get('refresh_token'),
    expires_at: p.get('expires_at')
      ? Number(p.get('expires_at')) * 1000
      : Date.now() + Number(p.get('expires_in') || 3600) * 1000
  };
  saveSession(s);
  return s;
}

async function refreshSession(s) {
  try {
    const r = await fetch(SUPA + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    if (!r.ok) { saveSession(null); return null; }
    const j = await r.json();
    const ns = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000
    };
    saveSession(ns);
    return ns;
  } catch { saveSession(null); return null; }
}

async function getSession() {
  const fromHash = sessionFromHash();
  if (fromHash && fromHash.error) { loginError = fromHash.error; return null; }
  let s = fromHash || loadSession();
  if (!s || !s.access_token) return null;
  if (s.expires_at && s.expires_at < Date.now() + 60000) s = await refreshSession(s);
  return s;
}

async function sendMagicLink(email) {
  const r = await fetch(SUPA + '/auth/v1/otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    // create_user: true so first login provisions the auth user; RLS is_admin()
    // still returns 0 rows to any non-allowlisted email — session ≠ data.
    body: JSON.stringify({
      email,
      create_user: true,
      redirect_to: location.origin + location.pathname
    })
  });
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); msg = j.msg || j.error_description || j.error || msg; } catch {}
    throw new Error(msg);
  }
}

async function signOut() {
  try {
    await fetch(SUPA + '/auth/v1/logout', {
      method: 'POST',
      headers: { apikey: ANON, Authorization: 'Bearer ' + session.access_token }
    });
  } catch {}
  session = null;
  saveSession(null);
  history.replaceState(null, '', location.pathname);
  showLogin('Signed out.');
}

/* ── PostgREST (reads + live-field updates, RLS session) ───────────────── */

async function rest(path, opts = {}) {
  const method = opts.method || 'GET';
  const headers = {
    apikey: ANON,
    Authorization: 'Bearer ' + session.access_token,
    'Content-Type': 'application/json'
  };
  if (method !== 'GET') headers.Prefer = 'return=representation';
  const r = await fetch(SUPA + '/rest/v1/' + path, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 300));
  return r.status === 204 ? null : r.json();
}

// /api/leads — service-role mutations (create, stage change) + activity rows.
async function callApi(method, payload) {
  const r = await fetch('/api/leads', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify(payload)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

async function loadData() {
  const [leads, tasks] = await Promise.all([
    rest('leads?select=' + LEAD_COLS + '&order=created_at.desc'),
    rest('tasks?select=id,lead_id,title,due_at,done&done=eq.false&order=due_at.asc')
  ]);
  data = { leads, tasks };
}

/* ── form helpers ──────────────────────────────────────────────────────── */

const inp = (name, label, val, type = 'text') => `
  <label>${label}<input name="${name}" type="${type}" value="${esc(val || '')}" /></label>`;
const ta = (name, label, val) => `
  <label>${label}<textarea name="${name}" rows="3">${esc(val || '')}</textarea></label>`;
const sel = (name, label, opts, val) => {
  const known = val && opts.includes(val);
  return `<label>${label}<select name="${name}">
    ${known ? '' : '<option value="">—</option>'}
    ${opts.map(o => `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}
  </select></label>`;
};

function leadFieldsHTML(l = {}) {
  return `
    <div class="grid">
      ${inp('name', 'Name *', l.name)}
      ${inp('email', 'Email', l.email, 'email')}
      ${inp('phone', 'Phone', l.phone, 'tel')}
      ${inp('business_name', 'Business', l.business_name)}
      ${sel('type', 'Type', TYPES, l.type)}
      ${sel('source', 'Source', SOURCES, l.source || 'MANUAL')}
      <label class="full">Problem<textarea name="problem" rows="2">${esc(l.problem || '')}</textarea></label>
      <label class="full">Project description<textarea name="project_description" rows="3">${esc(l.project_description || '')}</textarea></label>
      ${inp('budget', 'Budget', l.budget)}
      ${inp('timeline', 'Timeline', l.timeline)}
    </div>`;
}

function liveFieldsHTML(l = {}) {
  return `
    <div class="grid">
      ${sel('priority', 'Priority (override)', PRIORITIES, l.priority || 'MEDIUM')}
      ${inp('next_action', 'Next action', l.next_action)}
      <label class="full">Summary<textarea name="summary" rows="2">${esc(l.summary || '')}</textarea></label>
      <label class="full">Notes<textarea name="notes" rows="3">${esc(l.notes || '')}</textarea></label>
    </div>
    <label class="chk">
      <input type="checkbox" name="manual_today" ${l.manual_today ? 'checked' : ''} />
      manual_today — pin to top of NEXT ACTIONS
    </label>`;
}

function readForm(form, keys) {
  const fd = new FormData(form);
  const out = {};
  for (const k of keys) out[k] = String(fd.get(k) || '');
  return out;
}

/* ── views ─────────────────────────────────────────────────────────────── */

function renderToday() {
  const now = Date.now();
  const { leads, tasks } = data;
  const overdue = tasks.filter(t => !t.done && t.due_at && Date.parse(t.due_at) <= now);
  const counts = {
    neu: leads.filter(l => l.stage === 'NEW').length,
    qualified: leads.filter(l => l.stage === 'QUALIFIED').length,
    follow: overdue.length + leads.filter(l => l.manual_today).length
    // active projects: hidden until projects table exists (see ROADMAP — post-WON)
  };
  const rows = rankActions(data, now).slice(0, 10);

  const empty = leads.length === 0
    ? `<p class="muted">0 rows visible. Either no leads exist yet, or RLS filtered this
       session out — data only appears when the signed-in email matches
       <code>is_admin()</code> in migrations/0001_init.sql.
       <a href="#/new">Add the first lead</a>.</p>`
    : '';

  $('#main').innerHTML = `
    <h2>Today</h2>
    <div class="counts">
      <div class="count"><b>${counts.neu}</b><span>New inquiries</span></div>
      <div class="count"><b>${counts.qualified}</b><span>Qualified</span></div>
      <div class="count"><b>${counts.follow}</b><span>Follow-ups due</span></div>
    </div>
    ${empty}
    <h3>Next actions</h3>
    ${rows.length ? `
      <ul class="actions">
        ${rows.map(r => `
          <li>
            <a href="${r.leadId ? '#/lead/' + r.leadId : '#/pipeline'}">${esc(r.name)}</a>
            <span class="badge b-${r.stage}">${esc(r.stage)}</span>
            <span class="why">${esc(r.why)}</span>
            <span class="action">${esc(r.action)}</span>
          </li>`).join('')}
      </ul>
      <p class="muted"><a href="#/pipeline">View all → pipeline</a></p>`
    : `<p class="muted">Nothing ranked. Flag a lead <b>manual_today</b> or wait for overdue tasks.</p>`}
  `;
}

function renderPipeline(stage) {
  if (stage && STAGES.includes(stage)) return renderLeadList(stage);
  $('#main').innerHTML = `
    <h2>Pipeline</h2>
    <div class="board">
      ${STAGES.map(s => `
        <a class="col" href="#/pipeline/${s}">
          <span class="badge b-${s}">${s}</span>
          <span class="count-big">${data.leads.filter(l => l.stage === s).length}</span>
        </a>`).join('')}
    </div>
    <p class="muted">Click a column for its lead list.</p>`;
}

function renderLeadList(stage) {
  const leads = data.leads.filter(l => l.stage === stage);
  $('#main').innerHTML = `
    <p><a href="#/pipeline">← Pipeline</a></p>
    <h2>${stage} <span class="muted">(${leads.length})</span></h2>
    ${leads.length ? `
      <table class="tbl">
        <tr><th>Name</th><th>Business</th><th>Priority</th><th>Source</th></tr>
        ${leads.map(l => `
          <tr>
            <td><a href="#/lead/${l.id}">${esc(l.name)}</a></td>
            <td>${esc(l.business_name || '—')}</td>
            <td><span class="pri p-${l.priority || 'MEDIUM'}">${l.priority || 'MEDIUM'}</span></td>
            <td>${esc(l.source)}</td>
          </tr>`).join('')}
      </table>`
    : `<p class="muted">No leads in this stage. <a href="#/new">Create one</a>.</p>`}`;
}

function renderNew() {
  $('#main').innerHTML = `
    <h2>New lead</h2>
    <form id="lead-form">
      ${leadFieldsHTML()}
      <div class="grid" style="margin-top:0.7rem">
        ${sel('stage', 'Stage', STAGES, 'NEW')}
        ${sel('priority', 'Priority', PRIORITIES, 'MEDIUM')}
      </div>
      <p style="margin-top:0.9rem"><button class="btn" type="submit">Create lead</button></p>
      <p id="form-status" class="status" role="status"></p>
    </form>`;

  $('#lead-form').addEventListener('submit', async e => {
    e.preventDefault();
    const st = $('#form-status');
    st.className = 'status';
    st.textContent = 'Saving…';
    try {
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      const j = await callApi('POST', body);
      await loadData();
      location.hash = '#/lead/' + j.id;
    } catch (err) {
      st.className = 'status err';
      st.textContent = err.message;
    }
  });
}

const suggestState = {}; // per-lead on-demand suggest: inflight | done | failed

async function renderLead(id) {
  $('#main').innerHTML = '<p class="muted">Loading…</p>';
  let lead = data.leads.find(l => l.id === id);
  if (!lead) {
    try { await loadData(); lead = data.leads.find(l => l.id === id); } catch {}
  }
  if (!lead) {
    $('#main').innerHTML = '<p class="err">Lead not found (or RLS filtered it). <a href="#/today">Back to Today</a></p>';
    return;
  }

  // On-demand AI suggestion (0056 rev): generate when the operator opens a
  // lead that is pending but has no ai_* yet. Background post-response tasks
  // freeze on Vercel — generate inside the operator's request instead.
  if (lead.suggestion_status === 'pending' &&
      !lead.ai_summary && !lead.ai_priority && !lead.ai_next_action &&
      !suggestState[id]) {
    suggestState[id] = 'inflight';
    fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ action: 'suggest', lead_id: id })
    })
      .then(r => { suggestState[id] = r.ok ? 'done' : 'failed'; })
      .catch(() => { suggestState[id] = 'failed'; })
      .then(() => renderLead(id));
  }
  const suggestInflight = suggestState[id] === 'inflight';

  let acts = [];
  try {
    acts = await rest('activities?select=id,kind,body,draft_body,status,created_at&lead_id=eq.' + id + '&order=created_at.desc');
  } catch {}

  const trans = TRANSITIONS[lead.stage] || [];
  const tags = lead.problem_tags || [];
  const pendingSuggestion = lead.suggestion_status === 'pending' &&
    (lead.ai_summary || lead.ai_priority || lead.ai_next_action);

  $('#main').innerHTML = `
    <p><a href="#/pipeline/${lead.stage}">← ${lead.stage}</a> · <a href="#/today">Today</a></p>
    <div class="detail-head">
      <h2 style="margin:0">${esc(lead.name)}</h2>
      <span class="badge b-${lead.stage}">${lead.stage}</span>
      <span class="pri p-${lead.priority || 'MEDIUM'}">${lead.priority || 'MEDIUM'}</span>
      ${lead.manual_today ? '<span class="badge b-NEW">manual_today</span>' : ''}
    </div>
    <p class="muted">${esc(lead.type || '')} ${lead.business_name ? '· ' + esc(lead.business_name) : ''} · source ${esc(lead.source)} · created ${new Date(lead.created_at).toLocaleDateString()}</p>

    <form id="lead-form">
      <fieldset><legend>WHO</legend>
        <div class="grid">
          ${inp('name', 'Name *', lead.name)}
          ${inp('email', 'Email', lead.email, 'email')}
          ${inp('phone', 'Phone', lead.phone, 'tel')}
          ${inp('business_name', 'Business', lead.business_name)}
          ${sel('type', 'Type', TYPES, lead.type)}
          ${sel('source', 'Source', SOURCES, lead.source)}
        </div>
      </fieldset>
      <fieldset><legend>WHAT</legend>
        <div class="grid">
          <label class="full">Problem<textarea name="problem" rows="2">${esc(lead.problem || '')}</textarea></label>
          <label class="full">Project description<textarea name="project_description" rows="3">${esc(lead.project_description || '')}</textarea></label>
          ${inp('budget', 'Budget', lead.budget)}
          ${inp('timeline', 'Timeline', lead.timeline)}
        </div>
      </fieldset>
      <fieldset><legend>LIVE FIELDS + PRIORITY</legend>
        ${liveFieldsHTML(lead)}
      </fieldset>
      <button class="btn" type="submit">Save</button>
      <span id="save-status" class="status" role="status"></span>
    </form>

    <fieldset><legend>STAGE</legend>
      <form id="stage-form" class="inline">
        <div class="field">Move to
          <select name="stage" ${trans.length ? '' : 'disabled'}>
            <option value="">—</option>
            ${trans.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <button class="btn" type="submit" ${trans.length ? '' : 'disabled'}>Change stage</button>
      </form>
      <p class="muted" style="margin-top:0.4rem">
        ${trans.length ? 'Allowed from ' + lead.stage + ': ' + trans.join(', ') : 'Terminal stage — no transitions.'}
        Writes the auto activity row via /api/leads.
      </p>
    </fieldset>

    ${suggestInflight ? '<div class="suggestion"><b>Generating AI suggestions…</b></div>' : ''}
    ${pendingSuggestion ? `
      <div class="suggestion">
        <b>AI suggestion — pending approval</b>
        ${lead.ai_summary ? `<p><b>Summary:</b> ${esc(lead.ai_summary)}</p>` : ''}
        ${lead.ai_priority ? `<p><b>Priority:</b> <span class="pri p-${esc(lead.ai_priority)}">${esc(lead.ai_priority)}</span>${lead.ai_priority_reason ? ' — ' + esc(lead.ai_priority_reason) : ''}</p>` : ''}
        ${lead.ai_next_action ? `<p><b>Next:</b> ${esc(lead.ai_next_action)}</p>` : ''}
        <button class="btn" type="button" id="approve-btn">Approve</button>
        <button class="btn" type="button" id="dismiss-btn">Dismiss</button>
        <span id="sugg-status" class="status" role="status"></span>
        <!-- DATA_MODEL approve arrow. Two calls (PATCH lead + POST activity)
             are NOT atomic — ceiling: a crash between them leaves copied live
             fields without an audit row. ponytail: PostgREST rpc/transaction
             if that gap ever matters. ai_* kept on approve (diagram copies,
             doesn't clear). -->
      </div>` : ''}

    <fieldset><legend>PROBLEM TAGS</legend>
      <p>${tags.length ? tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') : '<span class="muted">none</span>'}</p>
      <p class="muted">Read-only — editing ships with ticket 0058.</p>
    </fieldset>

    <div class="timeline">
      <h3>Activity</h3>
      <p><button class="btn" type="button" id="draft-btn">Draft follow-up</button>
         <span id="draft-status" class="status" role="status"></span></p>
      ${acts.length ? acts.map(a => `
        <div class="act">
          <span class="act-kind">${esc(a.kind || '')}</span>
          <time>${new Date(a.created_at).toLocaleString()}</time>
          <div>${esc(a.body || '')}${a.draft_body ? '<br><i>' + esc(a.draft_body) + '</i>' : ''}</div>
          ${a.kind === 'draft' && a.draft_body ? `
            <div class="act-actions">
              <button class="btn copy-draft" type="button" data-draft="${esc(a.draft_body)}">Copy</button>
              <select class="draft-status" data-id="${a.id}" aria-label="draft status">
                ${['pending', 'sent', 'discarded'].map(s =>
                  `<option value="${s}" ${a.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>` : ''}
        </div>`).join('')
      : '<p class="muted">No activities yet.</p>'}
    </div>
  `;

  // Live-field save → PostgREST PATCH (admin UPDATE policy). Stage is excluded
  // on purpose — it must go through /api/leads (transition + activity row).
  $('#lead-form').addEventListener('submit', async e => {
    e.preventDefault();
    const st = $('#save-status');
    st.className = 'status';
    st.textContent = 'Saving…';
    try {
      const body = readForm(e.target, EDIT_KEYS);
      body.manual_today = e.target.querySelector('[name=manual_today]').checked;
      await rest('leads?id=eq.' + id, { method: 'PATCH', body });
      await loadData();
      await renderLead(id);
    } catch (err) {
      st.className = 'status err';
      st.textContent = err.message;
    }
  });

  // Stage change → /api/leads PATCH (service-role): validates transition,
  // writes stage_change activity. Client TRANSITIONS map only shapes the dropdown.
  $('#stage-form').addEventListener('submit', async e => {
    e.preventDefault();
    const to = e.target.stage.value;
    if (!to) return;
    try {
      const j = await callApi('PATCH', { id, stage: to });
      await loadData();
      await renderLead(id);
      const st = $('#save-status');
      if (st) { st.className = 'status'; st.textContent = 'Stage → ' + j.stage; }
    } catch (err) {
      const st = $('#save-status');
      if (st) { st.className = 'status err'; st.textContent = err.message; }
    }
  });

  /* ── 0056: approval gate (DATA_MODEL diagram — approve / dismiss) ────── */

  const suggSt = $('#sugg-status');
  const setSuggBtns = off => {
    const a = $('#approve-btn'), d = $('#dismiss-btn');
    if (a) a.disabled = off;
    if (d) d.disabled = off;
  };

  const approveBtn = $('#approve-btn');
  if (approveBtn) approveBtn.addEventListener('click', async () => {
    suggSt.className = 'status';
    suggSt.textContent = 'Approving…';
    setSuggBtns(true);
    try {
      // copy ai_* → live fields (NOT atomic with the activity row below —
      // ceiling noted in the card comment)
      await rest('leads?id=eq.' + id, {
        method: 'PATCH',
        body: {
          summary: lead.ai_summary,
          priority: lead.ai_priority,
          next_action: lead.ai_next_action,
          suggestion_status: 'approved',
          updated_at: new Date().toISOString()
        }
      });
      // audit row via new 0002 INSERT policy — best-effort, approve stands
      try {
        await rest('activities', {
          method: 'POST',
          body: { lead_id: id, kind: 'approve', body: 'Approved: ' + lead.ai_priority }
        });
      } catch (e) { console.warn('approve activity row failed:', e.message); }
      await loadData();
      await renderLead(id); // pending card gone; live fields feed ranking
    } catch (err) {
      suggSt.className = 'status err';
      suggSt.textContent = err.message;
      setSuggBtns(false);
    }
  });

  const dismissBtn = $('#dismiss-btn');
  if (dismissBtn) dismissBtn.addEventListener('click', async () => {
    suggSt.className = 'status';
    suggSt.textContent = 'Dismissing…';
    setSuggBtns(true);
    try {
      // clear ai_* + flip status (diagram dismiss arrow); live fields untouched
      await rest('leads?id=eq.' + id, {
        method: 'PATCH',
        body: {
          suggestion_status: 'dismissed',
          ai_summary: null,
          ai_priority: null,
          ai_priority_reason: null,
          ai_next_action: null,
          updated_at: new Date().toISOString()
        }
      });
      try {
        await rest('activities', {
          method: 'POST',
          body: { lead_id: id, kind: 'dismiss', body: 'Dismissed suggestion' }
        });
      } catch (e) { console.warn('dismiss activity row failed:', e.message); }
      await loadData();
      await renderLead(id);
    } catch (err) {
      suggSt.className = 'status err';
      suggSt.textContent = err.message;
      setSuggBtns(false);
    }
  });

  /* ── 0056: follow-up draft (on-demand → /api/suggest.js) ─────────────── */

  $('#draft-btn').addEventListener('click', async () => {
    const btn = $('#draft-btn');
    const st = $('#draft-status');
    btn.disabled = true;
    st.className = 'status';
    st.textContent = 'Drafting…';
    try {
      const r = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ action: 'draft', lead_id: id })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      await loadData();
      await renderLead(id); // new draft row lands in the timeline
    } catch (err) {
      btn.disabled = false;
      st.className = 'status err';
      st.textContent = err.message;
    }
  });

  document.querySelectorAll('.copy-draft').forEach(b =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.draft);
        b.textContent = 'Copied';
      } catch { /* clipboard denied — user can select manually */ }
    }));

  document.querySelectorAll('.draft-status').forEach(sel =>
    sel.addEventListener('change', async () => {
      try {
        // 0002 UPDATE policy: operator flips pending → sent/discarded
        await rest('activities?id=eq.' + sel.dataset.id, {
          method: 'PATCH',
          body: { status: sel.value }
        });
        await loadData();
        await renderLead(id);
      } catch (err) {
        console.warn('draft status update failed:', err.message);
      }
    }));
}

/* ── router + boot ─────────────────────────────────────────────────────── */

function route() {
  const h = location.hash;
  document.querySelectorAll('[data-nav]').forEach(a =>
    a.classList.toggle('on', h.startsWith(a.getAttribute('href'))));
  if (h.startsWith('#/lead/')) return renderLead(h.slice(7));
  if (h.startsWith('#/pipeline/')) return renderPipeline(h.slice('#/pipeline/'.length));
  if (h.startsWith('#/pipeline')) return renderPipeline(null);
  if (h.startsWith('#/new')) return renderNew();
  renderToday();
}

function showLogin(msg) {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  const st = $('#login-status');
  st.textContent = msg || loginError || '';
  st.className = msg || loginError ? 'status err' : 'status';
}

function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

async function boot() {
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const st = $('#login-status');
    const btn = $('#login-btn');
    st.className = 'status';
    st.textContent = 'Sending magic link…';
    btn.disabled = true;
    try {
      await sendMagicLink($('#login-email').value.trim());
      st.textContent = 'Sent — check your inbox for the sign-in link (valid ~1h).';
    } catch (err) {
      st.className = 'status err';
      st.textContent = 'Failed: ' + err.message +
        ' — check Supabase Auth → Email provider is enabled and Site URL / redirect URLs allow this origin.';
    } finally { btn.disabled = false; }
  });
  $('#signout').addEventListener('click', signOut);
  window.addEventListener('hashchange', () => { if (session) route(); });

  session = await getSession();
  if (!session) return showLogin(loginError);
  showApp();
  try {
    await loadData();
  } catch (err) {
    $('#main').innerHTML = '<p class="err">Load failed: ' + esc(err.message) +
      ' — <a href="javascript:location.reload()">retry</a> or sign out.</p>';
    return;
  }
  route();
}

boot();
