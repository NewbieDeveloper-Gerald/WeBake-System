# Phase 7 Teaching Notes — Deployment + End-to-End Proof

## What Phase 7 built (and why, in one line each)

- `docs/deployment.md` — the runbook: Supabase → Brevo → Render Blueprint →
  seed → Vercel → CORS loop-back → API + click-through checklists → ops/rollback.
- `frontend/vercel.json` — `/api/*` rewrite to the Render service so the static
  frontend calls same-origin (contains a placeholder host the owner replaces).
- `frontend/assets/qr-gcash-placeholder.png`, `qr-paymaya-placeholder.png` —
  honest placeholder QRs (labeled, encoding placeholder text). Seed defaults
  updated from the nonexistent `.svg` names to these real files.
- `admin-settings.js` QR fix — preview resolver prefixes `../../` for
  root-relative paths (same rule as checkout); unprefixed paths rendered broken
  images from the two-levels-deep admin page.
- `backend/package.json` engines pinned to `20.x` — Render builds reproduce the
  exact runtime the code was tested on instead of floating to newest LTS.
- E2E harness (throwaway, `/tmp/e2e.js`, real PostgreSQL 18 via PGlite):
  6 migrations → seed ×2 (idempotent) → 299-bundle rejection → 300-bundle order
  → idempotent replay → payment → approve → pipeline → balance guard → record
  balance → Completed → cancel + refund → payout → POS sale → cart merge →
  daily report → dashboard stats. ALL PASSING.

## Non-obvious lines (the parts worth re-reading)

1. PGlite query routing: multi-statement scripts must go to `exec()` WITHOUT a
   failed `query()` attempt first — the failure aborts the surrounding
   transaction and poisons everything after it. Heuristic: >1 semicolon or
   `$$` means exec.
2. Services assume zod-applied defaults (`delivery_time: ''`, `notes: ''`);
   calling them with raw input trips NOT NULL. Controllers always validate, so
   production is safe — the harness passes validated shapes.
3. `transition()` already guarded `COMPLETED` with `BALANCE_UNPAID`; only the
   Phase 5 UI copy was wrong ("this completes the order"). Fixed to the real
   two-step flow: record cash, then board-move.

## Lessons (including mistakes)

1. **The E2E caught a real UX lie.** `recordBalance` records money only; status
   completion is a separate board move enforced by `BALANCE_UNPAID`. The admin
   button/modal/alert all claimed otherwise. Only a lifecycle test walking the
   whole path could see it — unit tests passed because each half was correct.
2. **Seed pointed at files that never existed** (`assets/*.svg`). Broken QR
   images on day one, in both checkout and settings. Generating the placeholders
   + aligning all three consumers (seed, checkout, admin preview) closed it.
3. **PGlite > pg-mem for this stack**: triggers + plpgsql + `FOR UPDATE` need a
   real engine. The WASM build ran PostgreSQL 18 with zero setup.
4. **Harness failures were all harness bugs** (exec routing, missing defaults)
   until the recordBalance finding — which is exactly the base rate you want:
   distrust the test first, and the real bug stands out.

## Verification log (all passing)

- E2E on real Postgres: migrate 6/6, seed counts (1/8/4/9), re-run no-op,
  BELOW_MINIMUM at 299, order math, duplicate replay, stock deduction
  (7500 pcs), BALANCE_UNPAID guard, COMPLETED, cancel→PENDING→REFUNDED, POS
  change, cart merge (300+100=400), report exclusions, dashboard stats.
- `node --check` on touched files; boot tests unchanged (ports 5060–5065).
- QR PNGs render (visually inspected); vercel.json is valid JSON.

## Gaps / after go-live (NOT in this phase)

- Actually clicking through Render/Vercel/Supabase/Brevo dashboards (needs the
  owner's accounts) — the runbook is written so anyone can follow it.
- Real QR images + wallet numbers (owner provides after deploy).
- Receipt PDF for customers, delivery-date scheduling UI, review display.
- Load test beyond free-tier expectations; uptime monitoring (e.g. Better Stack
  ping on `/health` to mask cold starts).
