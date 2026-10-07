# Phase 4 Teaching Notes - OTP, Mailer, Payments, Rejection Flow

Goal of this phase: money movement. Database-backed OTP, the Brevo HTTPS
mailer with all 8 bilingual templates, proof-photo uploads to private Storage,
downpayment submission, approval (stock deduction), rejection with one
resubmission chance, member registration with guest-order linking, and both
password-reset flows.

## 1. File map

| File | What | Why |
|---|---|---|
| `migrations/004_otp.sql` | `otp_codes` table (hash, purpose, expiry, attempts, verified/consumed stamps) | Codes survive Render restarts; hashes survive database leaks |
| `services/emailTemplates.js` | 8 pure template builders (EN + Filipino in one body) | Testable without network; amounts formatted from centavos |
| `services/mailerService.js` | Brevo HTTPS client + `bestEffort()` wrapper | SMTP is blocked on Render free; post-commit emails must never roll back |
| `services/otpService.js` | request/verify/consume with cooldown + attempt caps | Purpose-bound, single-use, timing-safe codes |
| `services/storageService.js` | Proof upload + signed admin view URLs (private bucket) | Proofs stay private; customers never get URLs |
| `services/paymentService.js` | Submit / approve / reject transactions | Approval deducts stock; rejection branches on resubmit count |
| `services/memberService.js` | Register (OTP-gated), profile, passwords | OTP-first ordering blocks account enumeration |
| `services/passwordResetService.js` | Owner reset link (hashed token, 30 min, one use) | Spec Q8; uniform responses hide admin existence |
| `middleware/uploadProof.js` | Multer memory upload, 5MB, images only | Buffer-to-Storage, no disk, bilingual upload errors |
| `validators/otp|payments|members.js` | Purpose enum, 13/16-digit refs, account shapes | Channel-dependent ref rules via superRefine |
| `controllers/otp|payments|members.js` | Thin HTTP layers | Same thin-controller discipline as Phases 2-3 |
| `routes/otp.js` + route edits | send/verify, `:code/payment`, approve/reject, register/profile/resets | Multipart runs BEFORE validation (multer fills req.body) |

## 2. Data flow: guest order with OTP (the full Phase 4 chain)

```text
1. POST /api/otp/send {email, CHECKOUT} -> otpLimiter -> requestCode():
   cooldown ok? -> random 6 digits -> INSERT hash -> Brevo send
   (mail fails -> row DELETED so cooldown never traps the user)
2. POST /api/otp/verify {email, CHECKOUT, code} -> timing-safe compare ->
   verified_at = NOW() (single-use stamp)
3. POST /api/orders {...} (no member token) -> requireCheckoutOtp=true ->
   BEGIN -> idempotency? -> consumeVerification() claims the code row ->
   server pricing -> INSERT order/items/history -> COMMIT
4. POST /api/orders/WB-X/payment (multipart: channel, ref, proof file) ->
   uploadProof -> validateBody -> storage.uploadProof() [before BEGIN:
   network I/O never holds a transaction] -> BEGIN -> lock, PUV check,
   no pending payment -> INSERT payment PENDING -> COMMIT ->
   best-effort acknowledgement receipt (PENDING VERIFICATION)
5a. POST /api/admin/orders/WB-X/approve -> lock order -> lock products ->
    stock short? 409 INSUFFICIENT_STOCK + per-product details (Q4 notice data)
    else deduct + APPROVAL_DEDUCTION rows -> payment VERIFIED ->
    order CONFIRMED -> history -> COMMIT -> best-effort approval email
5b. POST .../reject {reason} (1st) -> payment REJECTED, resubmit_count=1 ->
    email with ONE resubmit chance -> customer repeats step 4
    POST .../reject {reason} (2nd) -> order CANCELLED + refund row
    AWAITING_DETAILS + history -> email with wallet-details link
```

## 3. Non-obvious lines, explained

- `UPDATE ... WHERE id = (SELECT ... FOR one fresh row) RETURNING id` in
  consumeVerification: the check-and-claim is ONE atomic statement, so two
  concurrent checkouts cannot spend the same code.
- `crypto.timingSafeEqual(guess, stored)`: plain `===` exits on the first
  differing byte, leaking closeness through response time. Constant-time
  comparison closes that side channel.
- Upload-before-BEGIN in submitDownpayment: holding a DB transaction open
  during a network upload starves the pool. The accepted trade-off is a rare
  orphan file in a private bucket (invisible, tiny).
- `LEGACY...` contrasts with `sha256hex(token)` for resets: tokens hash for
  the same reason passwords do - the token IS the credential.
- `identityFrom` shared via require (not copied): cancel, refund-details, and
  payment submission obey ONE ownership rule. A fix in one place fixes all.
- `errorHandler` passes `details`/`retryAfter` only on non-500s: structured
  conflict data (stock shortages) reaches the UI without ever leaking
  internals on crashes.

## 4. What was verified (all passing)

1. `node --check` on all 26 touched files.
2. Unit tests: GCash-13/Maya-16 acceptance + cross-rejection, 5-digit OTP
   rejection, all 9 template renders (subject + marker + text), template
   no-emoji scan, mailer 503-without-key.
3. Live boot: OTP/register/payment validation -> bilingual 400s;
   PROOF_REQUIRED before any DB touch; .txt upload -> UPLOAD_INVALID;
   member/admin guards -> 401s; approve/reject mounted and guarded.

## 5. Process lesson: parallel edits to the SAME file race

Phase 4 testing caught an infrastructure bug in how the work was assembled:
several `edit_file` calls targeting the SAME file in one parallel batch
reported success, but only one edit per file survived (concurrent
read-modify-write). Symptoms were 404s on new routes and
`identityFrom is not a function`. The fix: same-file edits go SEQUENTIALLY
(or the file is rewritten whole with `write_file`), and every batch is
verified with grep + boot tests before moving on. Different files in one
batch remain safe.

## 6. What you learned

- **OTP done right**: hash storage, purpose binding, cooldowns, attempt caps,
  single-use stamps, atomic consume, delete-on-mail-failure.
- **Two email policies**: OTP send FAILS the request (undelivered code is
  useless); post-commit emails are BEST-EFFORT (committed money never
  un-commits for mail).
- **Resubmit-once as a counter**: `resubmit_count` makes "one chance" a data
  invariant, not a UI hope - the second rejection path is reachable exactly
  once by construction.
- **Private Storage pattern**: service-role uploads, signed URLs for admin
  eyes only, customers get emails instead of file links.

## 7. Known gaps (intentional - next phases)

- Verification-queue UI data (proof signed URLs endpoint), sales reports +
  PDF, POS walk-in endpoint, settings UI, dashboard stats -> Phase 5.
- Cart sync endpoints, checkout/tracking/cancel UI, i18n toggle, link-contract
  pages (`track.html`, admin `reset.html`) -> Phase 6.
- Brevo sender verification + Storage bucket creation are manual dashboard
  steps -> Phase 7 deployment guide.
