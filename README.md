# WeBake - Crumbs N' Rolls Bakery

Web-based inventory and sales system replacing the bakery's paper logbooks.
Online wholesale ordering (300-bundle minimum, 50% downpayment) plus walk-in
POS, stock tracking, refunds, bilingual receipts, and sales reports.

## Architecture (no serverless)

- `backend/` - Express API, deployed as ONE Render web service (`render.yaml`
  blueprint). Health check: `GET /health`.
- `frontend/customer/` - static storefront, deployed on Vercel.
- `frontend/admin/` - static owner panel, deployed on Vercel (same site).
- `frontend/assets/` - canonical logo + favicon (swap files to rebrand).
- `docs/` - teaching notes per phase + deployment guides.

## Local development

Requirements: Node.js 18+, a Supabase PostgreSQL database.

```bash
cd backend
cp .env.example .env        # fill in DATABASE_URL + JWT_SECRET at minimum
npm install
npm run migrate             # create tables (000 -> 004)
npm run seed                # owner admin + 8 products + reviews + settings
npm run dev                 # API on http://localhost:5000
```

Open the storefront by serving `frontend/customer/html/home.html`
(any static server, e.g. `npx serve frontend/customer`), with
`WEBAKE_API_BASE` in `frontend/customer/js/config.js` pointing at the API.

## Scripts (backend)

| Command | Purpose |
|---|---|
| `npm start` | production boot (`node server.js`, what Render runs) |
| `npm run dev` | auto-reload dev boot |
| `npm run migrate` | apply pending `.sql` migrations, oldest first |
| `npm run seed` | idempotent seed (safe to re-run, never overwrites) |

## Key conventions

- Money: integer **centavos** in API + DB, `PHP 1,234.56` only for display.
- Stock: stored in **pieces**; bundles shown as pieces / 25.
- Auth: JWT Bearer tokens (`member` 7 days, `admin` 12 hours).
- Errors: `{ success: false, code, message_en, message_fil }` - always JSON.
- Docs: `docs/phase-N-notes.md` explains what, why, data flow, and lessons.
