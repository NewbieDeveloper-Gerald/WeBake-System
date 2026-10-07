# Phase 5 Teaching Notes — Dashboard, Verification, POS, Reports, Settings, Admin UI

## What Phase 5 built (and why, in one line each)

Backend:

- `src/db/migrations/005_walkin.sql` — `walkin_sales` + `walkin_sale_items`. Separate from
  `orders` because counter sales are anonymous and paid in full (no lifecycle, no customer),
  but stock moves through the SAME `stock_movements` table so the shelf count stays truthful.
- `src/services/settingsService.js` — key/value store: `getAll` / `update` (admin), `getNumber`
  (typed read with fallback), `getPublic` (checkout-safe subset). Business rules live here so
  the owner changes them without a redeploy.
- `src/services/posService.js` — atomic counter sale: lock products, price from catalog,
  check stock, deduct (+`POS_SALE` movements), verify cash covers total, record sale, receipt.
  Bundles consume `qty * pieces_per_bundle` pieces; pieces consume `qty` pieces.
- `src/services/dashboardService.js` — one payload for the admin home: today's online/walk-in
  sales, verification depth, orders by status, low stock, recent orders, refund alerts,
  outstanding balances. Parallel queries, no request waterfall.
- `src/services/reportService.js` — `rangeFor` (daily/weekly-Monday/monthly half-open ranges),
  `getSales` (online + walk-in + collected + refunded + per-product merge), `renderPdf`
  (pdfkit, A4, manual table layout with page breaks). ONE data function feeds JSON and PDF.
- `src/services/verificationService.js` — PUV orders with pending payment, items, resubmit
  state, and a short-lived signed URL per proof. Storage-disabled mode returns the queue
  with `proof_url: null` instead of failing (order data is still useful).
- `src/validators/pos.js|reports.js|settings.js` — sale shape, period+anchor query, strict
  partial settings update (unknown keys rejected, wallets keep `09XXXXXXXXX` format).
- `src/controllers/reportsController.js|posController.js|settingsController.js`,
  `src/routes/adminReports.js|adminPos.js|adminSettings.js|settings.js|adminVerification.js`,
  `paymentsController.queue` — thin HTTP layer; PDF served with `Content-Disposition`.
- `orderService` change: minimum order now reads `settings.min_order_bundles` (env fallback).
- NEW `POST /api/admin/orders/:code/cancel` (service bypass `identity.adminBypass` +
  `adminCancelSchema` + controller + route): admin cancels open the refund as
  `AWAITING_DETAILS` with NULL wallet fields — the customer submits details via email link.
- NEW `GET /api/admin/orders/:code` (reuses `orderView`): the admin list has no line items,
  and the details modal needs them.

Frontend (`frontend/admin/`):

- `html/login.html|reset.html|dashboard.html|products.html` — the four missing shells, built
  on the surviving shells' layout (sidebar / topbar / cards) and CSS variables.
- `js/admin-api.js` — typed fetch client: base URL from `customer/js/config.js`, Bearer
  header, English error translation, 401 auto-redirect. Every page uses it; no raw fetch.
- `js/admin-auth.js` — session lifecycle: login, forgot/reset forms, profile fill, logout.
- `js/admin-main.js` — token guard, mobile sidebar, nav badges from ONE dashboard call, and
  `AdminUI` helpers (`pesos`, `fmtDate` in Asia/Manila, `esc` XSS guard, `pill`).
- 7 page scripts (`admin-dashboard|products|orders|refunds|inventory|settings|pos.js`) —
  each renders its shell from the API. Legacy adaptations are documented in each file header.

## Non-obvious lines (the parts worth re-reading)

1. `reportService.js` — cancelled orders are excluded in SQL (`status <> 'CANCELLED'`), refunds
   are a separate line, and `NET = collected - refunded`. Never net silently.
2. `posService.js` — `cashReceived < total` throws `409 CASH_SHORT` with both amounts AFTER
   the stock check but BEFORE any write; the receipt strips the internal `pieces` field.
3. `orderService.js` `cancelOrder` — the admin path reuses `reason_source = 'ADMIN_REJECTION'`
   because migration 002's CHECK constraint only allows `('CUSTOMER','ADMIN_REJECTION')`.
   Honest trade-off, documented here instead of a new migration for one value.
4. `admin-orders.js` — the details modal's status dropdown is built as
   `[current, ...legalNexts]`; the save button is disabled unless a real move is selected.
5. `admin-dashboard.js` — PDF export uses a blob URL + temporary `<a download>`: the file
   downloads without navigating away from the dashboard.

## Lessons (including mistakes)

1. **UI work starts by reading routes, not memory.** My first `admin-api.js` draft had five
   wrong contracts (`/approve-payment` vs `/approve`, POST-transition vs PATCH-status,
   POST-archive vs DELETE, POST-adjust vs PATCH, `/:id/movements` vs `/movements?product_id=`).
   Every one was caught by grepping the real route files before wiring pages. Contract-first,
   always.
2. **Read the enum before drawing the tabs.** The machine has SIX statuses — there is no
   `PENDING_DOWNPAYMENT` or `READY`. The orders tabs were rebuilt to the real six.
3. **Read the card shape before rendering.** Low-stock cards carry `bundles_available`, not
   `stock_bundles_whole`. One grep of `toCard`, one fix.
4. **Legacy shells: hide, don't delete; rebuild small parts via JS.** Batch/spoilage loggers,
   downpayment/advance/e-wallet POS blocks, and extra settings fields are hidden with a
   comment saying why; table heads and tabs are rebuilt; adjustment/business-rule cards are
   injected. Nothing a future reader can't trace.
5. **Stray line caught in review:** a leftover defensive no-op (`ui.setText = null`) was
   removed from `admin-dashboard.js` before finishing. Dead code is a lie about what runs.

## Verification log (all passing)

- `node --check` on all 19 new backend files + 10 frontend scripts.
- Backend units: daily/weekly(Mon-start)/monthly ranges, POS/report/settings validators
  (accept + cross-reject), `%PDF` magic bytes on a rendered sample report (2456 bytes).
- Boot tests (ports 5062/5063, dead DB): new admin endpoints 401 without token, public
  settings 500-generic, new detail/cancel routes 401 (routed + guarded).
- Frontend: scripted ID cross-check — every `getElementById` in all 8 scripts resolves
  against its shell (dynamic IDs included); `byStatus` key fix verified against service.

## Gaps / Phase 6 preview (NOT in this phase)

- Customer storefront, checkout + payment submission UI, tracking page, member login, cart
  sync across devices, EN/Filipino toggle, customer wallet-details form (AWAITING emails
  link to it), QR image files for settings paths, full deployment runbook.
