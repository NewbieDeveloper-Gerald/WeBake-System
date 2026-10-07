# Render Integration (direct, no serverless)

## What changed and why

The old project ran its API as Vercel serverless functions (`api/` folder,
12-function limit, cold starts per endpoint). That approach was retired:

- One Express service is simpler to reason about, test, and debug.
- Background-safe features (rate limiting, uploads, PDF reports) fit a
  long-running service better than 10-second function windows.
- Render's free tier hosts it at zero cost; SMTP is bypassed via Brevo HTTPS.

The old function files were removed from `webake/legacy/` in favor of Render.
Reference copies still exist outside this project (`/home/user/uploads/` and
the original GitHub repo) if anything needs a look-back.

## How Render connects to this repo

`webake/render.yaml` is a **Blueprint**: it declares the `webake-api` service
(runtime, directories, commands, health check, env vars). Creating a Blueprint
instance in the Render dashboard reads this file and provisions everything;
Render prompts only for the `sync: false` secrets (database URL, API keys).

Key wiring:

| Concern | Value |
|---|---|
| Root directory | `backend` (so `npm install` + `node server.js` run there) |
| Pre-deploy | `npm run migrate` (schema migrates before new code goes live) |
| Health check | `GET /health` (200 healthy, 503 degraded - Render waits for 200) |
| Region | Singapore (closest to customers; Supabase should match) |
| CORS | `FRONTEND_URL` env = the Vercel URL (set after Vercel deploy, then redeploy API) |

## Free-tier realities (handled, not hidden)

- **Cold starts**: after ~15 minutes idle, the first request wakes the service
  (up to ~60s). The frontend shows loading states; the Phase 7 guide covers
  wake-up behavior and the upgrade path.
- **No SMTP**: ports 25/465/587 are blocked on free services, which is why all
  email goes through the Brevo HTTPS API.
- **Ephemeral disk**: proof photos go to Supabase Storage, never local disk.

## Verify after deploy (30 seconds)

1. Open `https://<your-api>.onrender.com/health` - expect `"status":"healthy"`.
2. `POST /api/admin/login` with the seeded owner credentials - expect a token.
3. `GET /api/products` - expect the 8 products.

The full click-by-click deployment runbook (Supabase, Brevo, Render, Vercel,
wiring, test checklist, troubleshooting) ships as the Phase 7 guide.
