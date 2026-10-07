# Phase 2 Teaching Notes - Backend Foundation

Goal of this phase: a bootable, secure-by-default API skeleton. No business
features yet - just the ground every later phase stands on: config, database
pool, auth primitives, validation, rate limiting, and error handling.

## 1. File map (what each file does and why it exists)

| File | What | Why |
|---|---|---|
| `backend/server.js` | Process entry: loads config, starts listening, handles crashes | Keeps process concerns out of `app.js` so tests can import the app without opening a port |
| `backend/src/app.js` | Builds the Express app: CORS, JSON parsing, route mounting, error handlers | One place showing middleware ORDER, which is the most common Express bug source |
| `backend/src/config/env.js` | Validates env vars once, exports frozen config | Fail fast at boot with a clear message instead of failing mid-request at night |
| `backend/src/config/db.js` | `pg` Pool + `query` / `getClient` / `ping` | Pools reuse connections; helpers enforce parameterized SQL and catch leaks |
| `backend/src/utils/password.js` | bcrypt hash + verify | Slow hashing makes a stolen database expensive to crack |
| `backend/src/utils/jwt.js` | Sign member/admin tokens, verify, parse Bearer header | Lets a static site on Vercel prove identity to an API on Render with no session table |
| `backend/src/validators/common.js` | Shared zod fields + bilingual error formatter + `validateBody` | Every route returns the same error shape in English and Filipino |
| `backend/src/validators/auth.js` | `loginSchema` | One obvious place answering "what does login accept" |
| `backend/src/middleware/asyncHandler.js` | Forwards async errors to `next(err)` | Express 4 drops async rejections; this closes that crash hole |
| `backend/src/middleware/requireMember.js` | Accepts `role: "member"` JWTs, sets `req.member` | Ownership checks downstream ("only your orders") need a trusted identity |
| `backend/src/middleware/requireAdmin.js` | Accepts `role: "admin"` JWTs, sets `req.admin` | Separate guard so roles can never silently share access |
| `backend/src/middleware/rateLimits.js` | Login / OTP / cancel / refund-details limiters | Secrets (passwords, 6-digit codes) must not be guessable at speed |
| `backend/src/middleware/errorHandler.js` | 404 catcher + final error middleware | API always answers JSON; stack traces never leak to browsers |
| `backend/src/services/authService.js` | Login logic: lookup, verify, sign token | All decisions here, testable without Express; uniform "invalid" message blocks account enumeration |
| `backend/src/controllers/authController.js` | HTTP translation for login + `/me` | Thin on purpose: status codes and JSON shape only, no SQL, no rules |
| `backend/src/routes/auth.js` | URL wiring for auth | Declarative table of contents: path -> limiter -> validator -> controller |
| `backend/src/routes/health.js` | `/health` + `/api/health` | Render pings this after deploy; 503 (not 200) when the DB is down |
| `backend/src/db/migrations/001_core.sql` | admins, members, carts, products, reviews, settings | Schema as code: every environment converges by running the same files |
| `backend/src/db/migrate.js` | Versioned runner with ledger table | Each file applies once, inside one transaction (all-or-nothing) |
| `backend/src/db/seed.js` | Owner admin, 8 products, sample reviews, settings | Idempotent: re-runs never overwrite passwords, stock, or owner edits |
| `backend/.env.example` | Every variable documented | The deploy checklist; `.env` itself is git-ignored |
| `frontend/.env.example` | Deploy-time settings doc for the static site | Static hosting has no runtime env, so this documents the one-line `config.js` edit instead |
| `frontend/assets/logo.png` | Canonical logo (from your upload) | Replace this file to rebrand; zero code changes |

## 2. Data flow: admin login (the pattern every later route copies)

```text
Browser                    API route              Controller           Service              Database
  | POST /api/auth/           |                      |                    |                     |
  |  /admin/login             |                      |                    |                     |
  |  {email, password}        |                      |                    |                     |
  |-------------------------->| loginLimiter         |                    |                     |
  |                           | (10 per 15 min)      |                    |                     |
  |                           | validateBody(schema) |                    |                     |
  |                           | (trim/lowercase,     |                    |                     |
  |                           |  400 if invalid)     |                    |                     |
  |                           |--------------------->| adminLogin()       |                     |
  |                           |                      |------------------->| loginAdmin()        |
  |                           |                      |                    |-------------------->|
  |                           |                      |                    | SELECT ... WHERE    |
  |                           |                      |                    | email = $1          |
  |                           |                      |                    |<-------------------|
  |                           |                      |                    | bcrypt.compare()    |
  |                           |                      |                    | signAdminToken()    |
  |                           |                      |<-------------------| {token, admin}      |
  |<--------------------------|<---------------------| 200 {success, ...} |                     |
```

Layers never skip: routes never query, controllers never decide, services
never touch `req`/`res`. When something breaks, the layer tells you where.

## 3. Key non-obvious lines, explained

- `app.set('trust proxy', 1)` - Render terminates TLS at its proxy. Without
  this, rate limiting sees the proxy IP for everyone and one abuser could lock
  out all users.
- `ssl: { rejectUnauthorized: false }` - the standard `pg` setting for the
  Supabase pooler; without SSL the pooler refuses the connection.
- `ON CONFLICT DO NOTHING` in seed - the idempotency guarantee: re-seeding a
  live database cannot clobber the owner password, stock counts, or settings.
- Money as `INTEGER` centavos - floats cannot represent 0.1 exactly; integers
  keep every peso exact forever. Display divides by 100 at the last moment.
- `role` inside the JWT + separate guards - a member token presented to an
  admin route fails closed, limiting what any single stolen token unlocks.

## 4. What was verified (smoke tests, all passing)

1. `node --check` on all 19 new files - zero syntax errors.
2. zod: valid login normalizes `USER@Mail.com` -> `user@mail.com`; invalid
   payloads return bilingual field errors.
3. bcrypt: correct password verifies, wrong password rejects.
4. JWT: member/admin roles round-trip; tampered tokens return null.
5. Live boot with a dead database: `/health` answers 503 `degraded` JSON
   (never crashes, never lies with 200).
6. Unknown route: 404 bilingual JSON. Bad login body: 400 bilingual JSON.
7. CORS: unlisted origin gets 403 `CORS_BLOCKED`; dev origin gets the
   `Access-Control-Allow-Origin` header.

## 5. What you learned

- **Layered architecture**: route -> controller -> service -> db. Each layer
  has one job, which makes bugs easy to locate and features easy to test.
- **Fail-fast config**: validating env vars at boot turns midnight mysteries
  into startup messages.
- **Security defaults that cost nothing**: bcrypt cost factor, JWT expiry,
  rate limits, CORS allowlist, uniform login errors, no stacks in prod.
- **Migrations as version control for the database**: schema changes are
  numbered files, applied once each, inside transactions.

## 6. Known gaps (intentional - later phases)

- Registration + password reset need OTP/email -> Phase 4.
- Tables for orders, payments, refunds, movements, history -> Phase 3.
- Admin `dashboard.html` / `products.html` shells were lost when the uploads
  were flattened (only customer versions survived) -> rebuilt in Phase 5.
- Customer `login.html` / `register.html` were never in the uploads (nav links
  point at them) -> built in Phase 6 with the OTP flow.
