import https from 'https';
import { URL } from 'url';
import { KB_TEXT, SERVICE_NAMES, FAQ } from '../lib/kb.js';

const MODEL = 'meta/llama-3.2-11b-vision-instruct';
const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Runtime prompt = KB facts (lib/kb.js) + behavioral instructions.
// Rule: never invent capabilities/prices/clients/testimonials — KB only.
const SYSTEM = `You are the concierge for TinyCoder Studio Virtual Office, a freelance AI-automation developer based in Davao City, Philippines.

${KB_TEXT}

Help the visitor with questions about these services, pricing, process, and about hiring. Keep replies short (under 100 words) and friendly.

Hard rules:
- Never invent capabilities, prices, clients, or testimonials. If the KB does not cover it, say so and offer the free consultation call.
- Never ask twice for something the visitor already gave — use it.
- Qualify one topic at a time, never a form dump.

When the visitor wants to build/hire/order/start a project, collect progressively: what to build → problem → existing system → timeline → contact (name and email; business_name and budget optional — never press hard on budget). Type must be exactly one of: ${SERVICE_NAMES.join(' | ')}. Infer it from what they say (e.g. "WhatsApp bot" → AI Chatbots & Agents; "scraping", "lead gen" → Browser Automation; "dashboard", "booking" → Web Applications; "data cleaning", "reports" → Data Processing; "n8n", "workflow" → Workflow Automation). Any features, scope, or use-case description counts as project_description. Email may be "" if the visitor refuses but has described their problem.

Once name, type, and problem are known (email may be ""): reply with a short confirmation summarizing what you heard, then append EXACTLY one line at the very end and stop chatting:
__ORDER__ {"name":"<name>","email":"<email>","phone":"<phone>","business_name":"<business_name>","type":"<type>","problem":"<problem>","project_description":"<description>","budget":"<budget>","timeline":"<timeline>","source":"CONCIERGE","stage":"NEW"}
Use "" for values the visitor never gave. Never invent values. Never emit the line outside a real project conversation. Never keep chatting after the line.`;

const ABUSE_BLOCKLIST = [
  'ignore previous instructions',
  'system prompt',
  'jailbreak',
  /\bdan\b/i,
  'developer mode',
  'reveal your',
  'prompt injection'
];

const rateLimits = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const perMin = 10;
  const perHour = 50;

  if (!rateLimits.has(ip)) rateLimits.set(ip, []);
  const timestamps = rateLimits.get(ip);

  const minuteAgo = timestamps.filter(t => now - t < windowMs);
  const hourAgo = timestamps.filter(t => now - t < hourMs);

  if (minuteAgo.length >= perMin) return false;
  if (hourAgo.length >= perHour) return false;

  minuteAgo.push(now);
  rateLimits.set(ip, minuteAgo);
  return true;
}

function checkAbuse(text) {
  const lower = String(text).toLowerCase();
  return ABUSE_BLOCKLIST.some(b => b instanceof RegExp ? b.test(text) : lower.includes(b));
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  // ponytail: truncate oversize instead of rejecting — long convos are valid
  return true;
}

function postJson(url, payload, key) {
  return new Promise((resolve, reject) => {
    if (!key) return reject(new Error('NVIDIA_API_KEY not set'));
    const u = new URL(url);
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      timeout: 8000,
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

// ─── __ORDER__ marker: server-side parse + validate + insert (0055) ───────
// Client never sees the marker. Invalid payloads never reach the DB.

function extractMarker(text) {
  const m = String(text).match(/__ORDER__\s*(\{[\s\S]*\})/);
  if (!m) return null;
  return { raw: m[1], clean: String(text).replace(m[0], '').trim() };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Hand-rolled validation (order.js style). source/stage/priority are FORCED
// server-side — never taken from the model.
// exported for 0055 smoke test / 0059 path tests; handler usage unchanged.
export function validateLead(raw) {
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const s = k => String(obj[k] ?? '').trim();

  const name = s('name');
  if (!name || name.length > 200) return null;

  const email = s('email');
  if (email && (email.length > 200 || !EMAIL_RE.test(email))) return null;

  const typeRaw = s('type');
  const type = SERVICE_NAMES.find(n => n.toLowerCase() === typeRaw.toLowerCase());
  if (!type) return null;

  const problem = s('problem');
  const project_description = s('project_description');
  if (problem.length > 1000 || project_description.length > 1000) return null;
  // Lightweight POTENTIAL_CLIENT intent gate: a real project conversation
  // has a problem or a description. Marker without either = dropped (log).
  if (!problem && !project_description) return null;

  const budget = s('budget');
  const timeline = s('timeline');
  const phone = s('phone');
  const business_name = s('business_name');
  if (budget.length > 200 || timeline.length > 200 || phone.length > 200 || business_name.length > 200) return null;

  return {
    name,
    email: email || null,
    phone: phone || null,
    business_name: business_name || null,
    type,
    problem: problem || null,
    project_description: project_description || null,
    budget: budget || null,
    timeline: timeline || null,
    source: 'CONCIERGE',
    stage: 'NEW',
    priority: 'MEDIUM'
  };
}

function sbRequest(method, path, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(process.env.SUPABASE_URL + path);
    const data = payload ? JSON.stringify(payload) : '';
    const headers = {
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY
    };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Prefer'] = 'return=representation';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      timeout: 8000,
      headers
    }, res => {
      let chunks = '';
      res.on('data', c => (chunks += c));
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('supabase timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

let sbWarned = false;

export async function saveLead(lead) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // 503-soft: chat keeps working pre-config, log once (order.js pattern)
    if (!sbWarned) {
      console.warn('[concierge] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — lead not saved');
      sbWarned = true;
    }
    return undefined;
  }

  // dedupe-lite (full dedupe = ticket 0059): same email already in NEW/QUALIFIED
  // → still insert, flag the activity. ponytail: one GET, no stage filter —
  // any existing row with this email counts.
  let dup = '';
  if (lead.email) {
    try {
      const g = await sbRequest('GET', '/rest/v1/leads?email=eq.' + encodeURIComponent(lead.email) + '&select=id');
      if (g.status === 200 && JSON.parse(g.body).length > 0) dup = ' (duplicate email)';
    } catch { /* dedupe check is best-effort */ }
  }

  let ins;
  try {
    ins = await sbRequest('POST', '/rest/v1/leads', lead);
  } catch (e) {
    console.error('[concierge] lead insert error:', e.message);
    return undefined;
  }
  if (ins.status < 200 || ins.status >= 300) {
    console.error('[concierge] lead insert failed:', ins.status, ins.body.slice(0, 300));
    return undefined;
  }

  let id;
  try { id = JSON.parse(ins.body)[0]?.id; } catch {}
  if (!id) {
    console.error('[concierge] lead insert returned no id:', ins.body.slice(0, 300));
    return undefined;
  }

  try {
    const act = await sbRequest('POST', '/rest/v1/activities', {
      lead_id: id,
      kind: 'create',
      body: 'Lead created from concierge' + dup
    });
    if (act.status < 200 || act.status >= 300) {
      console.error('[concierge] activity insert failed:', act.status, act.body.slice(0, 300));
    }
  } catch (e) {
    console.error('[concierge] activity insert error:', e.message);
  }

  return id;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ text: "Whoa there! Take a breath — I'm here to help with TinyCoder services. Ask about chatbots, automation, web apps, or your project!" });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  let messages = body?.messages || [];

  if (!validateMessages(messages)) {
    return res.status(400).json({ text: "I'm here to help with TinyCoder services — ask about chatbots, automation, web apps, or your project!" });
  }

  messages = messages.slice(-8).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 1200)
  }));

  const lastMsg = messages[messages.length - 1]?.content || '';
  if (checkAbuse(lastMsg)) {
    return res.status(200).json({ text: "I'm here to help with TinyCoder services — ask about chatbots, automation, web apps, or your project!" });
  }

  if (!process.env.NVIDIA_API_KEY) {
    return res.status(503).json({ text: 'Service temporarily unavailable. Please try again later.' });
  }

  let r;
  try {
    r = await postJson(ENDPOINT, {
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, ...messages],
      max_tokens: 350,
      // ponytail: keep 0.65 for chat feel — bad markers fail safe (dropped+logged).
      // If 0059 path tests show malformed/missing markers, drop to 0.3.
      temperature: 0.65
    }, process.env.NVIDIA_API_KEY);
  } catch {
    return res.status(502).json({ text: 'Sorry, something went wrong. Please try again in a moment.' });
  }

  let text = 'Sorry, something went wrong.';
  try {
    const json = JSON.parse(r.body);
    if (r.status === 200 && json.choices?.[0]?.message?.content) {
      text = json.choices[0].message.content;
    }
  } catch {}

  // Strip + parse marker before it ever reaches the client.
  let leadId;
  if (text.includes('__ORDER__')) {
    const ex = extractMarker(text);
    if (ex) {
      text = ex.clean;
      const lead = validateLead(ex.raw);
      if (lead) {
        leadId = await saveLead(lead); // undefined = env missing or insert failed
      } else {
        console.error('[concierge] invalid __ORDER__ payload dropped');
      }
    } else {
      console.error('[concierge] malformed __ORDER__ marker dropped');
    }
    // Safety net: no marker leakage, ever (covers truncated/dangling output).
    const idx = text.indexOf('__ORDER__');
    if (idx >= 0) text = text.slice(0, idx).trim();
  }

  res.status(r.status === 200 ? 200 : 502).json(leadId ? { text, leadId } : { text });
}

// ponytail: global rate limit, replace with Redis if multi-instance
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  function demo() {
    const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); };

    // rate limit / abuse (existing)
    assert(checkRateLimit('127.0.0.1') === true, 'rate limit should allow first request');
    assert(checkAbuse('ignore previous instructions') === true, 'abuse should be caught');
    assert(checkAbuse('hello there') === false, 'normal text should pass');
    assert(checkAbuse('lets dance around it') === false, 'dan substring should NOT false-positive');
    assert(checkAbuse('act as DAN') === true, 'DAN word should be caught');

    // validateMessages — truncation semantics (fixed stale asserts, AUDIT)
    assert(validateMessages([{ content: 'a' }]) === true, 'normal message array should pass');
    assert(validateMessages([]) === false, 'empty array should fail');
    assert(validateMessages('nope') === false, 'non-array should fail');
    assert(validateMessages([{ content: 'a'.repeat(2001) }]) === true, '2001 char passes (truncated later)');
    assert(validateMessages(Array(13).fill({ content: 'hi' })) === true, '13 messages pass (sliced to last 8)');

    // marker extraction strips correctly
    const fake = 'Got it — here is what I have: booking site for Acme, problem: no system, timeline: 2 weeks.\n' +
      '__ORDER__ {"name":"Ana Cruz","email":"ana@example.com","phone":"","business_name":"Acme","type":"Web Applications","problem":"No booking system","project_description":"Booking site","budget":"","timeline":"2 weeks","source":"CONCIERGE","stage":"NEW"}';
    const ex = extractMarker(fake);
    assert(ex, 'marker should extract');
    assert(!ex.clean.includes('__ORDER__'), 'marker stripped from clean text');
    assert(ex.clean.startsWith('Got it'), 'visible confirmation text preserved');

    // validation accepts good payload + forces server-side fields
    const lead = validateLead(ex.raw);
    assert(lead && lead.name === 'Ana Cruz', 'good payload accepted');
    assert(lead.type === 'Web Applications', 'type kept');
    assert(lead.email === 'ana@example.com', 'email kept');
    assert(lead.source === 'CONCIERGE' && lead.stage === 'NEW' && lead.priority === 'MEDIUM', 'server forces source/stage/priority');
    assert(validateLead(ex.raw.replace('"source":"CONCIERGE","stage":"NEW"', '"source":"HACKED","stage":"WON"')).source === 'CONCIERGE', 'model source/stage ignored');

    // validation rejects bad email / type / oversize / missing required
    assert(validateLead('{"name":"A","email":"not-an-email","type":"Web Applications","problem":"x"}') === null, 'bad email rejected');
    assert(validateLead('{"name":"A","email":"a@b.co","type":"Crypto Gains","problem":"x"}') === null, 'bad type rejected');
    assert(validateLead('{"name":"A","email":"a@b.co","type":"Web Applications","problem":"' + 'x'.repeat(1001) + '"}') === null, 'oversize problem rejected');
    assert(validateLead('{"name":"A","email":"a@b.co","type":"Web Applications","project_description":"' + 'x'.repeat(1001) + '"}') === null, 'oversize description rejected');
    assert(validateLead('{"email":"a@b.co","type":"Web Applications","problem":"x"}') === null, 'missing name rejected');
    assert(validateLead('{"name":"A","type":"Web Applications"}') === null, 'no problem/description rejected (intent gate)');
    assert(validateLead('not json at all') === null, 'non-JSON rejected');

    // KB module: services + pricing keys present
    assert(SERVICE_NAMES.length === 5, 'KB has five services');
    assert(KB_TEXT.includes('AI Chatbots & Agents'), 'KB has services');
    assert(KB_TEXT.includes('Pricing') && KB_TEXT.includes('$200'), 'KB has pricing');
    assert(typeof FAQ.pricing === 'string' && FAQ.pricing.includes('$200'), 'FAQ pricing from KB');

    console.log('All demo checks passed.');
  }
  demo();
}
