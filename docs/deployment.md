# WeBake Deployment Runbook — Render + Vercel + Supabase + Brevo

Target: backend API on Render (free), static frontend on Vercel (free),
Postgres + file storage on Supabase (free), email on Brevo (free).
Total running cost: P0.

Order matters: Supabase first (Render needs its URL), then Brevo, then Render,
then seed, then Vercel, then the FRONTEND_URL loop-back.

## 0. What you need before starting

- A GitHub account with this `webake/` folder pushed as a repo (root of repo =
  repo root: `render.yaml` at top, `backend/`, `frontend/`, `docs/`).
- One Gmail inbox you control: `crbwebake@gmail.com` (owner login, Brevo sender).
- A strong owner password (12+ characters, unique). It goes into Render as
  `ADMIN_PASSWORD` for the one-time seed, then stays only as a bcrypt hash.

## 1. Supabase — database + storage

1. Create a project at supabase.com, region **Singapore (ap-southeast-1)**
   (same region as the Render service = lowest latency).
2. Project Settings > Database: copy the **pooler** connection string
   (shared Session pooler, port **5432**). It looks like:
   `postgresql://postgres.PROJECT_REF:PASSWORD@POOLER-HOST:5432/postgres`
   Keep it; Render asks for it as `DATABASE_URL`.
3. Project Settings > API: copy the `service_role` key (server-only, never goes
   in the frontend) and the project URL. These become `SUPABASE_SERVICE_ROLE_KEY`
   and `SUPABASE_URL`.
4. Storage > New bucket: `payment-proofs`, **private** (default). This holds
   customer payment screenshots; the API serves them via short-lived signed URLs.
5. Storage > New bucket: `product-images`, **public**. Product photo uploads land
   here when the owner adds image URLs later.
6. Do NOT run any SQL by hand: migrations run automatically in the Render
   build step (verified end to end in Phase 7).

## 2. Brevo — email (OTP, receipts, refunds)

Render's free tier blocks outbound SMTP ports, so email goes over Brevo's HTTPS
API instead of Nodemailer.

1. Create a Brevo account (brevo.com, free = 300 emails/day).
2. Settings > Senders: add `crbwebake@gmail.com` as a sender and click the
   confirmation link Brevo emails to that inbox. Sends from an unverified
   address are rejected.
3. SMTP & API > API Keys: create a key, copy it (`BREVO_API_KEY`).
4. Without the key the API still boots, but OTP endpoints answer 503 and no
   email sends — checkout cannot work, so treat the key as required.

## 3. Render — backend API (Blueprint)

Full click-by-click version: `render-backend-setup.md`. Short version:

1. Push the repo to GitHub.
2. Render dashboard > New > **Blueprint** > select the repo. Render reads
   `render.yaml` and shows the `webake-api` service (node, free, singapore).
3. Fill the prompted secrets:
   - `DATABASE_URL` — Supabase pooler string from step 1.
   - `FRONTEND_URL` — temporary: `https://placeholder.local` (replaced with the
     real Vercel URL in step 6; any value boots).
   - `ADMIN_PASSWORD` — the strong owner password from step 0.
   - `BREVO_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
   - `JWT_SECRET` is auto-generated; the rest have safe defaults.
4. Deploy. Watch the logs: `npm run migrate` must report 6 applied migrations,
   then `node server.js` boots. Note the service URL:
   `https://webake-api-XXXX.onrender.com` (Dashboard > service > URL).
5. Free-tier realities: first request after ~15 idle minutes takes ~50s (cold
   start); the frontend just waits. Disk is ephemeral — nothing persistent is
   stored on it (proofs go to Supabase, data to Postgres).

## 4. Seed — owner account, products, settings (once)

1. Render service > **Shell** tab. Run:
   `cd backend && npm run seed`
   (The shell opens at the repo root; the app lives in `backend/`.)
2. Expect: `admin created`, 8 products, 4 sample reviews, 9 settings.
3. The seed refuses placeholder passwords and never overwrites existing data —
   re-running is a safe no-op (verified in Phase 7).
4. Sign in at `https://<render-url>/../admin` — no: the admin UI is served from
   the FRONTEND (Vercel). Until Vercel is up, verify via API (step 7) or serve
   `frontend/` locally (step 8).

## 5. Vercel — frontend (static)

1. In `frontend/vercel.json`, replace `REPLACE-WITH-RENDER-URL` with your real
   Render host (no `https://`, no trailing path). Commit and push. This rewrite
   makes same-origin `/api/*` calls work from the browser, so no CORS
   preflight pain and no API URL baked into the JS.
2. Vercel dashboard > Add New > Project > select the repo. Set **Root Directory**
   to `frontend/`. Framework preset: Other. No build command, no output
   directory (pure static HTML/CSS/JS).
3. Deploy. Note the URL: `https://webake-XXXX.vercel.app`.
4. The shop is at `/customer/html/home.html`, the admin portal at
   `/admin/html/login.html`. (There is no root landing page by design; bookmark
   both.)

## 6. Loop-back — CORS

1. Render service > Environment: set `FRONTEND_URL` to the exact Vercel URL
   (no trailing slash). Save — Render redeploys automatically.
2. Why last: the backend allowlists exactly one browser origin, and the Vercel
   URL only exists after step 5.

## 7. Verify — API checklist (run from any terminal)

Replace `$API` with the Render URL:

- `curl $API/health` → `{"status":"ok",...}` with `"connected":true`.
- `curl $API/api/products` → 8 products.
- `curl $API/api/settings/public` → wallet numbers + QR paths.
- `curl -X POST $API/api/auth/admin/login -H 'Content-Type: application/json' -d '{"email":"crbwebake@gmail.com","password":"<owner password>"}'` → token.
- CORS: `curl -H 'Origin: https://webake-XXXX.vercel.app' -I $API/api/products`
  → `access-control-allow-origin` echoes your Vercel URL. A wrong origin gets
  no header (browser blocks it).

## 8. Verify — click-through (owner, 15 minutes)

1. Admin: sign in, open Settings, replace the placeholder wallet numbers, QR
   image paths (commit real QR PNGs under `frontend/assets/` first), and store
   hours. Save.
2. Admin: Inventory — RESTOCK each product with real piece counts (seed starts
   everything at 0, so checkout is impossible until you do this).
3. Customer (incognito): add 300+ bundles, check out as guest, submit payment
   with a screenshot. Confirm the success receipt says pending verification.
4. Admin: Orders — verify the queued payment, approve it. Confirm the customer
   gets the approval email.
5. Customer: track the order with code + Gmail; confirm the timeline moved.
6. Admin: move it through production to out-for-delivery, record the cash
   balance, move to Completed. Confirm the track page shows Completed.

## 9. Day-to-day operations

- Business changes (wallet numbers, minimum order, hours): admin Settings page.
  No redeploy, no code.
- Price/stock changes: Products + Inventory pages.
- Code changes: push to GitHub; Render and Vercel redeploy automatically.
  Migrations run before each backend deploy — always backwards-compatible
  (additive changes only once live).
- Logs: Render service > Logs (every request error lands here; email failures
  log with the order code for manual follow-up).
- Backups: Supabase Dashboard > Database > Backups (daily on free projects).
- If JWT_SECRET ever leaks: change it in Render (all sessions die instantly,
  everyone signs in again) — there is no token revocation list by design.

## 10. Rollback

- Backend: Render service > Deploys > pick the previous commit > Redeploy.
  (Schema is additive, so old code runs fine on the new schema.)
- Frontend: Vercel project > Deployments > previous deployment > Promote.
- Data mistakes (wrong stock, bad setting): fix in the admin panel; seeds never
  overwrite live data.

## 11. Known limits (free-tier ceilings)

- Render free: cold starts (~50s), 750 instance-hours/month (one service fits),
  no SMTP (Brevo used instead), ephemeral disk (nothing stored on it).
- Brevo free: 300 emails/day — roughly 100 checkouts/day with receipts.
- Supabase free: 500MB database, 1GB storage — years of orders at this scale.
- First paid upgrade if the bakery outgrows free: Render Starter (no cold
  starts), nothing else needs to change.
