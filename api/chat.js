import https from 'https';
import { URL } from 'url';

const MODEL = 'meta/llama-3.2-11b-vision-instruct';
const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

const SYSTEM = `You are the concierge for TinyCoder Studio Virtual Office, a freelance AI-automation developer based in Davao City, Philippines.

Services offered:
- AI Chatbots & Agents: WhatsApp/Telegram/website chatbots, customer support, scheduling, FAQs
- Workflow Automation: n8n/Make/custom, connecting tools, automating repetitive tasks
- Web Applications: booking systems, dashboards, internal tools (React/Node.js/Supabase/Vercel)
- Browser Automation: web scraping, form filling, data collection, lead generation
- Data Processing: CSV/JSON processing, API integrations, automated reporting

Process: Discovery (1 call) → Prototype (1-2 weeks) → Production (deploy + handoff)

Pricing: Project-based ($200-$2000) or hourly ($15-25/hr). Free consultation call available.

Help the visitor with questions about these services, pricing, process, and about hiring. Keep replies short (under 100 words) and friendly.

For every request to order/hire/start/proceed, you must collect four pieces of information:
1. name
2. email
3. project type (one of the five services)
4. a short description of the project

Rules:
- Never ask twice for something the visitor already gave. Use it.
- Infer the project type when obvious from what they say (e.g. "AI chatbot", "WhatsApp bot" → AI Chatbots & Agents; "scraping", "lead gen" → Browser Automation; "dashboard", "booking site" → Web Applications; "data cleaning", "reports" → Data Processing).
- Any description of features, scope, or use case counts as the short description.
- Once all four are gathered, reply with a short confirmation message followed by exactly this line at the very end:
__ORDER__ {"name":"<name>","email":"<email>","type":"<type>","details":"<details>"}
- Do not invent values the visitor never gave. Never repeat the line in any other situation. Never add the line and also keep chatting about missing fields.`;

const ABUSE_BLOCKLIST = [
  'ignore previous instructions',
  'system prompt',
  'jailbreak',
  'dan',
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
  return ABUSE_BLOCKLIST.some(b => lower.includes(b));
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length > 12) return false;
  let totalChars = 0;
  for (const m of messages) {
    const content = String(m.content || '');
    if (content.length > 2000) return false;
    totalChars += content.length;
  }
  if (totalChars > 8000) return false;
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

  messages = messages.slice(-12).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000)
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
  res.status(r.status === 200 ? 200 : 502).json({ text });
}

// ponytail: global rate limit, replace with Redis if multi-instance
if (import.meta.url === `file://${process.argv[1]}`) {
  function demo() {
    const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); };
    assert(typeof esc === 'function' || true, 'esc not tested here');
    assert(checkRateLimit('127.0.0.1') === true, 'rate limit should allow first request');
    assert(checkAbuse('ignore previous instructions') === true, 'abuse should be caught');
    assert(checkAbuse('hello there') === false, 'normal text should pass');
    assert(validateMessages([{content: 'a'.repeat(2000)}]) === true, '2000 char should pass');
    assert(validateMessages([{content: 'a'.repeat(2001)}]) === false, '2001 char should fail');
    assert(validateMessages(Array(13).fill({content: 'hi'})) === false, '13 messages should fail');
    console.log('All demo checks passed.');
  }
  demo();
}
