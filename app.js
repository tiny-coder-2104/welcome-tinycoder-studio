import { FAQ } from './lib/kb.js';

// DOM refs guarded so `node app.js` reaches demo() (AUDIT: demo was unreachable).
const doc = typeof document !== 'undefined' ? document : null;
const chat = doc?.getElementById('chat');
const body = doc?.getElementById('chat-body');
const form = doc?.getElementById('chat-form');
const input = doc?.getElementById('chat-text');

const history = [];
let chatOpened = false;

// Magic-link fallback: if GoTrue redirects to Site URL (/) instead of
// /dashboard/ (redirect-allowlist mismatch), tokens land here in the hash.
// Forward them — dashboard's sessionFromHash() does the actual save.
if (doc && /(?:access_token|error)=/.test(location.hash)) {
  location.replace('/dashboard/' + location.hash);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(m) {
  const div = doc.createElement('div');
  div.className = 'msg ' + m.role;
  div.textContent = m.text;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

// FAQ strings live in lib/kb.js — same module feeds the server system prompt.
function renderFAQ(question) {
  const answer = FAQ[question];
  if (!answer) return;
  render({ role: 'bot', text: answer });
  history.push({ role: 'assistant', content: answer });
}

// 0055: server parses __ORDER__, validates, inserts the lead, returns
// {text, leadId} — client never sees the marker. Old client-side marker
// parse + renderOrder → /api/order flow removed (superseded); /api/order
// stays up server-side for any stale cached clients.
function renderLeadPanel(leadId) {
  const panel = doc.createElement('div');
  panel.className = 'order-panel';
  const p = doc.createElement('p');
  p.textContent = "Thanks. I've recorded your project inquiry. We'll review the details and get back to you shortly.";
  const ref = doc.createElement('p');
  ref.innerHTML = 'Reference: <code></code>';
  ref.querySelector('code').textContent = String(leadId);
  panel.appendChild(p);
  panel.appendChild(ref);
  body.appendChild(panel);
  body.scrollTop = body.scrollHeight;
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  render({ role: 'user', text });
  history.push({ role: 'user', content: text });
  const tdiv = doc.createElement('div');
  tdiv.className = 'msg bot typing';
  tdiv.textContent = 'typing…';
  body.appendChild(tdiv);
  body.scrollTop = body.scrollHeight;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // > server's 20s NVIDIA timeout + overhead
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-8) }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) {
      // API returns friendly text for 429/400/502 — show it
      let apiText = null;
      try { const err = await res.json(); apiText = err.text; } catch {}
      throw new Error(apiText || 'bad status');
    }
    const data = await res.json();
    history.push({ role: 'assistant', content: data.text });
    tdiv.remove();
    render({ role: 'bot', text: data.text });
    if (data.leadId) renderLeadPanel(data.leadId);
  } catch (e) {
    tdiv.remove();
    const errMsg = e.name === 'AbortError'
      ? 'The concierge took too long to respond. Please try again.'
      : (e.message && e.message !== 'bad status' && !e.message.startsWith('Unexpected')
          ? e.message
          : 'Sorry, something went wrong. Please try again in a moment.');
    render({ role: 'bot', text: errMsg });
  }
}

form?.addEventListener('submit', e => { e.preventDefault(); send(); });

function openChat() {
  chat.hidden = false;
  if (!chatOpened) {
    chatOpened = true;
    render({ role: 'bot', text: 'Welcome! I\'m your virtual office concierge. Ask me about services, projects, pricing, or tell me about your project. Or pick a question below!' });
  }
  input.focus();
}

doc?.querySelectorAll('[data-faq]').forEach(btn => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.faq;
    renderFAQ(q);
  });
});

// "I have a project" pill → open chat + kick off progressive qualification.
doc?.querySelector('[data-project]')?.addEventListener('click', () => {
  openChat();
  input.value = "I have a project I'd like to start";
  send();
});

doc?.querySelector('[data-open-chat]')?.addEventListener('click', openChat);
doc?.querySelector('[data-close-chat]')?.addEventListener('click', () => { chat.hidden = true; });

// ponytail: global rate limit, replace with Redis if multi-instance
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  function demo() {
    const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); };
    assert(esc('<b>hi</b>') === '&lt;b&gt;hi&lt;/b&gt;', 'esc should escape HTML');
    assert(FAQ['services'].includes('AI Chatbots'), 'FAQ services should mention chatbots');
    assert(FAQ['pricing'].includes('$200'), 'FAQ pricing should mention $200');
    assert(typeof FAQ['projects'] === 'string', 'FAQ projects should be a string');
    console.log('All demo checks passed.');
  }
  demo();
}
