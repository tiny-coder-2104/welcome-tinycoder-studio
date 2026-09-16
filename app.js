const chat = document.getElementById('chat');
const body = document.getElementById('chat-body');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-text');

const history = [];
let chatOpened = false;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(m) {
  const div = document.createElement('div');
  div.className = 'msg ' + m.role;
  div.textContent = m.text;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

const FAQ = {
  services: `I'm a freelance AI-automation developer based in Davao City, Philippines. I build:\n\n• AI Chatbots & Agents (WhatsApp/Telegram/website)\n• Workflow Automation (n8n/Make/custom)\n• Web Applications (booking systems, dashboards)\n• Browser Automation (scraping, lead gen)\n• Data Processing (CSV/JSON, APIs, reports)`,
  projects: `Recent work includes:\n\n📊 DavaoBook — Booking Management System for Davao tourism operators\n🧰 TinyCoder Toolbox — PWA with 5 dev tools (offline-first)\n💬 AI Customer Support Agent — WhatsApp/website chatbot handling 80% of inquiries automatically`,
  help: `I can help you:\n\n1. Build AI chatbots that handle customer support 24/7\n2. Automate repetitive workflows so your team focuses on growth\n3. Create custom web apps (dashboards, booking, internal tools)\n4. Set up browser automation for scraping and data collection\n5. Process and analyze your data with automated reporting\n\nJust tell me what you need!`,
  pricing: `Pricing is project-based ($200–$2000) or hourly ($15–$25/hr). I also offer a free consultation call to discuss your needs.\n\nProcess:\n1. Discovery — 1 call to understand your problem\n2. Prototype — 1–2 weeks to build a working version\n3. Production — deploy + handoff, your automation runs 24/7`
};

function renderFAQ(question) {
  const answer = FAQ[question];
  if (!answer) return;
  render({ role: 'bot', text: answer });
  history.push({ role: 'assistant', content: answer });
}

function renderOrder(order) {
  const panel = document.createElement('div');
  panel.className = 'order-panel';
  function row(label, val) {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${label}:</strong> ${esc(val)}`;
    return p;
  }
  panel.appendChild(row('Name', order.name));
  panel.appendChild(row('Email', order.email));
  panel.appendChild(row('Project type', order.type));
  panel.appendChild(row('Details', order.details));
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = 'Send Order Request';
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order)
      });
      const ok = res.ok;
      btn.remove();
      const done = document.createElement('p');
      done.textContent = ok
        ? `Order sent! I'll get back to you at ${order.email} soon.`
        : 'Failed to send. Please email tiny-coder-2104@agentmail.to directly.';
      panel.appendChild(done);
    } catch {
      btn.disabled = false;
      btn.textContent = 'Send Order Request';
    }
  };
  panel.appendChild(btn);
  body.appendChild(panel);
  body.scrollTop = body.scrollHeight;
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  render({ role: 'user', text });
  history.push({ role: 'user', content: text });
  const tdiv = document.createElement('div');
  tdiv.className = 'msg bot typing';
  tdiv.textContent = 'typing…';
  body.appendChild(tdiv);
  body.scrollTop = body.scrollHeight;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-12) }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    history.push({ role: 'assistant', content: data.text });
    tdiv.remove();
    const orderMatch = data.text.match(/__ORDER__\s*(\{[\s\S]*\})/);
    if (orderMatch) {
      const order = JSON.parse(orderMatch[1]);
      render({ role: 'bot', text: data.text.replace(/__ORDER__\s*\{[\s\S]*\}/, '') });
      renderOrder(order);
    } else {
      render({ role: 'bot', text: data.text });
    }
  } catch (e) {
    tdiv.remove();
    const errMsg = e.name === 'AbortError'
      ? 'The concierge took too long to respond. Please try again.'
      : 'Sorry, something went wrong. Please try again in a moment.';
    render({ role: 'bot', text: errMsg });
  }
}

form.addEventListener('submit', e => { e.preventDefault(); send(); });

function openChat() {
  chat.hidden = false;
  if (!chatOpened) {
    chatOpened = true;
    render({ role: 'bot', text: 'Welcome! I\'m your virtual office concierge. Ask me about services, projects, pricing, or tell me about your project. Or pick a question below!' });
  }
  input.focus();
}

document.querySelectorAll('[data-faq]').forEach(btn => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.faq;
    renderFAQ(q);
  });
});

document.querySelector('[data-open-chat]')?.addEventListener('click', openChat);
document.querySelector('[data-close-chat]')?.addEventListener('click', () => { chat.hidden = true; });

// ponytail: global rate limit, replace with Redis if multi-instance
if (import.meta.url === `file://${process.argv[1]}`) {
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
