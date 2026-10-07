# Phase 6 Teaching Notes — Customer Storefront

## What Phase 6 built (and why, in one line each)

Backend:

- `src/validators/cart.js`, `services/cartService.js`, `controllers/cartController.js`,
  `routes/cart.js`, `app.js` mount — member cart sync (spec Q9): `GET /api/cart` reads
  lines, `PUT /api/cart` replaces them, `{merge: true}` sums guest lines in at sign-in.
  Lines store NO prices; checkout always re-prices from the catalog.
- `orderService` `paymentsFor()` — `orderView`/`trackOrder` now include payment attempts
  (metadata only), so the track page can tell "payment pending" from "no payment yet"
  from "rejected, may resubmit".
- FIX `validators/payments.js` — `submitPaymentSchema` now accepts optional `email`.
  Without it, guests got 404/400 on payment submit (strict schema rejected the identity
  email the controller reads). Members were unaffected (JWT identity).

Frontend (`frontend/customer/`):

- `js/shop-api.js` (new) — typed client: base URL from `WEBAKE_CONFIG`, optional member
  token, FormData proof uploads, bilingual errors picked by active locale.
- `js/utils.js` (rewritten) — helpers plus the manual EN/FIL system: frozen dictionary,
  `t(key)`, `data-i18n` attributes, injected nav toggle, localStorage persistence, member
  locale sync to profile. Marketing paragraphs stay English (documented scope cut).
- `js/main.js` (rewritten) — products page: catalog, bundle-quantity modal, cart sidebar
  (guest localStorage / member debounced DB sync), 5-step checkout with minimum-order
  enforcement, OTP skip for members using their own email, server-amount review,
  channel-dependent ref validation (GCash 13 / Maya 16), pending-verification receipt.
- `js/auth.js` (rewritten) — session, nav auth-buttons on every page, login, REGISTER /
  RESET OTP flows, registration with guest-cart merge, logout.
- `js/otp.js` (rewritten) — reusable 6-box widget: auto-advance, backspace-back, paste
  spread, auto-submit, 60s resend cooldown.
- `js/modals.js` (rewritten) — self-contained track-order modal on every
  `data-track-order-open` link (no shell edits needed).
- `js/tracking.js` (rewritten) — `track.html`: lookup, 6-stage timeline, payment
  submit/resubmit, type-twice wallet form for awaiting refunds, cancel with confirm.
- `js/dashboard.js` (rewritten) — member home: profile edit, saved cart, order history
  with track links, injected change-password card, 401 bounce to login.
- `html/track.html|login.html|register.html` (new) — the three missing pages, on the
  existing customer design system. All shells gained the `shop-api.js` script tag.

## Non-obvious lines (the parts worth re-reading)

1. `main.js` `createOrderThenPayment()` — the order is created BEFORE the payment step
   renders, so the review shows SERVER amounts (downpayment rounding included), never
   client estimates.
2. `main.js` payment submit — guests send `email` in the FormData; members send the
   token, EXCEPT when the order email differs from the member email (then both).
3. `tracking.js` `renderPayment()` — three PUV states from one payload: pending payment
   (wait note), no payment + `resubmit_count >= 1` (resubmit form + rejection reason),
   no payment at all (fresh submit for abandoned checkouts).
4. `utils.js` `relabelNav()` — static English nav links are rewritten to the active
   locale by href matching, so zero legacy shells needed hand-editing for i18n.
5. `cartService.set()` merge — sums bundles per product instead of appending lines;
   validator caps at 50 lines, service drops non-integer junk defensively.

## Lessons (including mistakes)

1. **Phase 5 admin-login paths were wrong and untested.** `AdminAPI` called
   `/api/auth/login`, `/forgot-password`, `/reset-password` — all 404. The real paths
   are `/admin`-scoped, and the base URL had to be read from `WEBAKE_CONFIG.API_BASE`
   (with `/api` suffix stripped), not the imagined `WB_CONFIG`. Fixed + boot-verified
   this phase (400 on the real path, 404 on the old). Lesson: every client endpoint
   gets a route-existence check before the phase closes — applied to all 14 ShopAPI
   paths this time.
2. **Guest payment submit was impossible** (strict schema vs identity email, above).
   Wiring the REAL second consumer (guest checkout) caught what the first consumer
   (member flows) never exercised. Lesson: strict schemas + optional identity fields
   must be reviewed together.
3. **Read the CSS visibility mechanism before toggling.** Customer CSS uses `.active`,
   not `.open` (modals, sidebar, checkout steps, toast); the mobile nav had a toggle
   button but NO show rule at all. Fixed in JS + one appended CSS rule, plus a block
   of styles for JS-rendered elements the legacy CSS never defined.
4. **The `edit_file` tool choked twice on one line** (mechanical `&&` line in auth.js);
   `sed` via bash fixed both occurrences in one shot. Fallback noted, not a habit.
5. **Login/register return `member.name`, not `member.full_name`** (`publicMember`
   renames it). Caught by reading the service, not by a runtime error — contract-first
   again.

## Verification log (all passing)

- `node --check` on 8 customer scripts + touched backend/admin files.
- Backend units: cart schema (valid/merge-default/bad-qty), payment schema (guest
  email accepted, member omits, bad email + wrong ref length rejected).
- Boot tests (ports 5064/5065, dead DB): cart 401s, member 401s, products 500-public,
  admin-login 400-exists, old login path 404-confirmed-dead.
- Frontend: scripted ID cross-check — every `getElementById`/`querySelector(#id)` in
  all 7 scripts resolves against its shell(s), dynamic IDs included.
- Endpoint audit: all 14 ShopAPI paths matched to real route definitions.
- CSS audit: every class the JS toggles or injects verified in the stylesheets
  (missing ones appended, toggle names corrected).

## Gaps / Phase 7 preview (NOT in this phase)

- Full deployment runbook (Render backend + Vercel frontend + Supabase + Brevo env),
  seed script run, QR image files for settings paths, end-to-end test with a LIVE
  database, receipt PDF for customers, delivery-date scheduling UI, rate-limit UX copy.
