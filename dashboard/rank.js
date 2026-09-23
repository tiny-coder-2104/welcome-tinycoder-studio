// dashboard/rank.js — pure pipeline rules: next-action ranking (PIPELINE_SPEC §3)
// + stage transition map (PIPELINE_SPEC §1). No DOM, no network — runnable under
// node16 for the demo() self-checks (house style: no test framework).
//
// Shared source of truth: dashboard imports for display, api/leads.js imports
// for server-side enforcement (client map can't bypass — server re-checks).

export const STAGES = ['NEW', 'QUALIFIED', 'CONTACTED', 'PROPOSAL', 'WON', 'LOST', 'NURTURE'];

// Stage depth = active pipeline only. NURTURE/WON/LOST are out of ranking
// (unless manual_today — the operator flag outranks everything).
export const STAGE_DEPTH = { NEW: 0, QUALIFIED: 1, CONTACTED: 2, PROPOSAL: 3 };

// Valid transitions (PIPELINE_SPEC §1). NURTURE branches from any active stage;
// NURTURE reactivates to QUALIFIED; WON/LOST terminal.
export const TRANSITIONS = {
  NEW: ['QUALIFIED', 'NURTURE', 'LOST'],
  QUALIFIED: ['CONTACTED', 'NURTURE', 'LOST'],
  CONTACTED: ['PROPOSAL', 'NURTURE', 'LOST'],
  PROPOSAL: ['WON', 'LOST', 'NURTURE'],
  NURTURE: ['QUALIFIED'],
  WON: [],
  LOST: []
};

const IDLE_MS = 48 * 3600 * 1000; // tier-2 follow-up clock
const SUGGESTED = {
  NEW: 'Qualify this lead',
  QUALIFIED: 'Reach out',
  CONTACTED: 'Follow up — check inbox',
  PROPOSAL: 'Call to close'
};

// updated_at is the idle proxy (leads trigger bumps it on every UPDATE).
const ts = l => Date.parse(l.updated_at || l.created_at || 0) || 0;

function age(ms, now) {
  const d = Math.floor((now - ms) / 86400000);
  if (d >= 1) return d + (d === 1 ? ' day' : ' days');
  return Math.max(1, Math.floor((now - ms) / 3600000)) + 'h';
}

// Rows: { tier, leadId?, taskId?, name, stage, why, action } — already in
// tier order. Lead shown at most once (manual/task rows suppress tier 2/3 dupes).
export function rankActions({ leads = [], tasks = [] }, now = Date.now()) {
  const rows = [];
  const byId = new Map(leads.map(l => [l.id, l]));
  const seen = new Set();

  // Tier 1a — operator said so: manual_today wins, nothing outranks it.
  for (const l of [...leads].filter(l => l.manual_today).sort((a, b) => ts(a) - ts(b))) {
    seen.add(l.id);
    rows.push({
      tier: 1, leadId: l.id, name: l.name, stage: l.stage,
      why: 'manual_today set by you',
      action: l.next_action || SUGGESTED[l.stage] || 'Act on this today'
    });
  }

  // Tier 1b — overdue tasks, oldest due first. Standalone (lead_id null) → stage '-'.
  const overdue = tasks
    .filter(t => !t.done && t.due_at && Date.parse(t.due_at) <= now)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  for (const t of overdue) {
    const lead = t.lead_id ? byId.get(t.lead_id) : null;
    if (lead) seen.add(lead.id);
    rows.push({
      tier: 1, taskId: t.id, leadId: lead ? lead.id : null,
      name: '(task) ' + t.title, stage: lead ? lead.stage : '-',
      why: 'task overdue: "' + t.title + '"', action: 'Do it today'
    });
  }

  const eligible = leads.filter(l => l.stage in STAGE_DEPTH && !seen.has(l.id));

  // Tier 2 — QUALIFIED+ with no activity >48h, oldest idle first.
  const idle = eligible
    .filter(l => STAGE_DEPTH[l.stage] >= 1 && now - ts(l) > IDLE_MS)
    .sort((a, b) => ts(a) - ts(b));
  for (const l of idle) {
    seen.add(l.id);
    rows.push({
      tier: 2, leadId: l.id, name: l.name, stage: l.stage,
      why: l.stage.toLowerCase() + ', ' + age(ts(l), now) + ' no activity',
      action: l.next_action || SUGGESTED[l.stage]
    });
  }

  // Tier 3 — remaining active: oldest first, deeper stage breaks ties
  // (a stale PROPOSAL beats a stale NEW).
  const rest = eligible
    .filter(l => !seen.has(l.id))
    .sort((a, b) => ts(a) - ts(b) || STAGE_DEPTH[b.stage] - STAGE_DEPTH[a.stage]);
  for (const l of rest) {
    rows.push({
      tier: 3, leadId: l.id, name: l.name, stage: l.stage,
      why: 'stale ' + age(ts(l), now) + ' in ' + l.stage.toLowerCase(),
      action: l.next_action || SUGGESTED[l.stage]
    });
  }

  return rows;
}

// demo() self-check — run from repo dir: node16 dashboard/rank.js
if (typeof process !== 'undefined' && import.meta.url === 'file://' + process.argv[1]) {
  const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
  const now = Date.parse('2026-09-23T12:00:00Z');
  const iso = ms => new Date(ms).toISOString();
  const H = 3600e3, D = 86400e3;

  const staleQ = { id: 'q', name: 'Stale Q', stage: 'QUALIFIED', updated_at: iso(now - 3 * D), created_at: iso(now - 10 * D), manual_today: false, next_action: null };
  const manual = { id: 'm', name: 'Manual', stage: 'NEW', updated_at: iso(now - H), created_at: iso(now - H), manual_today: true, next_action: null };

  // 1) manual_today outranks stale qualified; tiers come out ordered
  let rows = rankActions({ leads: [staleQ, manual], tasks: [] }, now);
  assert(rows[0].leadId === 'm', 'manual_today outranks stale qualified');
  assert(rows[0].tier === 1 && rows[1].leadId === 'q' && rows[1].tier === 2, 'tier 1 before tier 2');

  // 2) overdue open task = tier 1 and tops the list when nothing is manual;
  //    future/done tasks never rank; parent lead suppressed (no dup rows)
  rows = rankActions({
    leads: [staleQ],
    tasks: [
      { id: 't1', lead_id: 'q', title: 'send contract', done: false, due_at: iso(now - H) },
      { id: 't2', lead_id: null, title: 'later', done: false, due_at: iso(now + D) },
      { id: 't3', lead_id: null, title: 'done', done: true, due_at: iso(now - D) }
    ]
  }, now);
  assert(rows[0].taskId === 't1' && rows[0].tier === 1, 'overdue task tops list at tier 1');
  assert(rows[0].stage === 'QUALIFIED', 'task row shows parent lead stage');
  assert(!rows.some(r => r.taskId === 't2'), 'future-dated task not ranked');
  assert(!rows.some(r => r.taskId === 't3'), 'done task not ranked');
  assert(!rows.some(r => r.leadId === 'q' && r.tier === 2), 'task parent not duplicated in tier 2');

  // 2b) standalone task (lead_id null) shows stage '-'
  rows = rankActions({ leads: [], tasks: [{ id: 'x', lead_id: null, title: 'solo', done: false, due_at: iso(now - H) }] }, now);
  assert(rows[0].stage === '-' && rows[0].name === '(task) solo', 'standalone task shows stage -');

  // 3) ordering within tier 2: oldest idle first
  const idleOlder = { id: 'i1', name: 'Older', stage: 'QUALIFIED', updated_at: iso(now - 5 * D), created_at: iso(now - 6 * D), manual_today: false };
  const idleNewer = { id: 'i2', name: 'Newer', stage: 'QUALIFIED', updated_at: iso(now - 3 * D), created_at: iso(now - 4 * D), manual_today: false };
  rows = rankActions({ leads: [idleNewer, idleOlder], tasks: [] }, now);
  assert(rows[0].leadId === 'i1' && rows[1].leadId === 'i2', 'older idle first within tier 2');

  // 3b) tier-3 tie at equal timestamp: deeper stage wins
  const shallow = { id: 's', name: 'NewFresh', stage: 'NEW', updated_at: iso(now - 2 * H), created_at: iso(now - 2 * H), manual_today: false };
  const deep = { id: 'd', name: 'PropFresh', stage: 'PROPOSAL', updated_at: iso(now - 2 * H), created_at: iso(now - 2 * H), manual_today: false };
  rows = rankActions({ leads: [shallow, deep], tasks: [] }, now);
  assert(rows[0].leadId === 'd' && rows[1].leadId === 's', 'deeper stage breaks tier-3 ties');

  // 4) terminal/nurture stages stay out of ranking (no manual flag)
  rows = rankActions({
    leads: [
      { id: 'w', name: 'Won', stage: 'WON', updated_at: iso(now - 30 * D), created_at: iso(now - 40 * D), manual_today: false },
      { id: 'n', name: 'Nur', stage: 'NURTURE', updated_at: iso(now - 30 * D), created_at: iso(now - 40 * D), manual_today: false }
    ],
    tasks: []
  }, now);
  assert(rows.length === 0, 'WON/NURTURE without manual_today stay out of ranking');

  console.log('rank.js demo: all 11 checks passed.');
}
