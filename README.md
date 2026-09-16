# TinyCoder Studio — Virtual Office

A cozy 2D lobby PWA with AI concierge chat. Based in Davao City, Philippines.

## Quick Start

```bash
npm install
npm run dev
```

## Deploy to Vercel

1. Push to GitHub: `git push -u origin main`
2. Import repo at [vercel.com](https://vercel.com) → Add New Project → select `tiny-coder-2104/welcome-tinycoder-studio`
3. Set environment variable in Vercel Dashboard → Project → Settings → Environment Variables:
   - `NVIDIA_API_KEY` — your NVIDIA API key for the RAG concierge
   - `AGENTMAIL_API_KEY` — your AgentMail API key for order delivery
   - `AGENTMAIL_INBOX_ID` — your inbox ID (default: `tiny-coder-2104@agentmail.to`)
4. Vercel auto-deploys on push. The `vercel.json` config ensures API routes run on Node.js 16.

## Local Dev

Requires Node.js 16. The `api/` directory uses native `https` module — no extra dependencies.

## License

TinyCoder Studio Virtual Office.
