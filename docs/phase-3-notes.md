# Phase 3 Teaching Notes - Products, Inventory, Orders, Refunds

Goal of this phase: the money-and-stock core. Catalog APIs, the inventory
writer with its audit trail, order creation with server-side pricing, locked
status transitions, the cancel transaction with stock return, and the refund
queue API. Payment verification and emails arrive in Phase 4.

## 1. File map

| File | What | Why |
|---|---|---|
| `migrations/000_legacy_stash.sql` | Renames old-schema tables to `legacy_*` (guarded by signature columns) | Same table names, different columns: without stashing, 001/002 would keep the wrong tables |
| `migrations/002_orders.sql` | orders, order_items, payments, refund_requests, order_status_history, stock_movements | Spec-shaped tables; TEXT+CHECK statuses mirror `orderMachine.js` |
| `migrations/003_legacy_remap.sql` | One-time import from `legacy_*` (no-op on fresh DBs) | Preserves history: members, catalog, orders, payments, refunds |
| `utils/money.js` | Centavos math: `downpaymentFor` (round up), `balanceFor`, `formatPesos` | Integer money is exact forever; floats drift by centavos |
| `utils/orderMachine.js` | Status constants + transition map + guards | One file decides every legal move; DB CHECKs are the second lock |
| `utils/serviceError.js` | Bilingual `fail/notFound/conflict` errors | Services explain failures without touching HTTP |
| `validators/products.js` | Catalog create/update + stock adjust (exactly one of set/delta) | No silent stock edits: every write carries reason + note |
| `validators/orders.js` | Create (300-min), track, cancel, refund-details, transitions | Business rules at the boundary; type-twice shared helper |
| `validators/refunds.js` | mark-refunded + close (mandatory note) | Q11: closing without paying must explain why |
| `services/inventoryService.js` | The ONLY stock writer; movement log; low-stock | One writer + append-only log = any count is reconcilable |
| `services/productService.js` | Public/admin lists, create, update, archive/restore | Archive preserves history; hard delete does not exist |
| `services/orderService.js` | Create, track, history, transitions, balance, cancel | All writes are locked transactions (see flows below) |
| `services/refundService.js` | Wallet-details submit, queue, mark-refunded, close | Refund lifecycle separate from order status |
| `controllers/*` + `routes/*` | Thin HTTP layers; 6 route groups mounted in `app.js` | Same pattern as Phase 2: routes declare, controllers translate |

## 2. Data flow: order creation (server-side pricing)

```text
Browser                    Validator              Service                    Database
 POST /api/orders            |                        |                         |
 {customer, items:           |                        |                         |
  [{product_id, bundles}],   |                        |                         |
  payment_method}            |                        |                         |
---------------------------->| 300-bundle refine      |                         |
                             | (400 if under)         |                         |
                             |----------------------->| BEGIN                   |
                             |                        | idempotency replay?     |--SELECT orders
                             |                        | catalog lookup          |--SELECT products
                             |                        | price = DB price x qty  |
                             |                        | (browser price ignored) |
                             |                        | down = ceil(total/2)    |
                             |                        | INSERT order (PUV)      |--INSERT
                             |                        | INSERT items (snapshot) |--INSERT x N
                             |                        | INSERT history          |--INSERT
                             |                        | COMMIT                  |
<----------------------------|<-----------------------| 201 {order, downpayment}|
```

Key idea: the request carries NO prices, so there is nothing to tamper with.
Snapshots in `order_items` keep old receipts truthful after price changes.

## 3. Data flow: customer cancel (the spec transaction)

```text
 POST /api/orders/WB-123/cancel  -> cancelLimiter -> validateBody -> controller
   -> orderService.cancelOrder():
     BEGIN
     SELECT * FROM orders WHERE order_code=$1 FOR UPDATE   -- lock, winner takes all
     ownership? member(id/email match) or guest(email match) else 404
     status in (PUV, CONFIRMED)? else 409 ORDER_NOT_CANCELLABLE
     IF CONFIRMED:
       FOR EACH item (products locked in id order - deadlock-safe):
         stock_pieces += bundles * pieces_per_bundle
         INSERT stock_movements (CANCELLATION_RETURN, +pieces)
     UPDATE orders SET status=CANCELLED
     INSERT refund_requests (CUSTOMER, PENDING, amount=full downpayment)
     INSERT order_status_history (old->CANCELLED, CUSTOMER)
     COMMIT
```

Why `FOR UPDATE`: without it, an admin approval and a customer cancel can both
read CONFIRMED-eligible state and both act. With it, the second transaction
waits, then sees CANCELLED and fails cleanly with 409. The UNIQUE(order_id) on
refunds is the backstop even if two cancels slip through.

## 4. Data flow: admin transition + balance (locked the same way)

- `PATCH /api/admin/orders/:code/status {status, note}`: lock -> `canTransition`
  check -> COMPLETED requires `balance_due_centavos = 0` (409 otherwise) ->
  update + history -> commit. PUV->CONFIRMED is rejected here on purpose:
  only payment approval (Phase 4) may confirm, because only it deducts stock.
- `POST /api/admin/orders/:code/record-balance`: lock -> status must be
  CONFIRMED/IN_PRODUCTION/OUT_FOR_DELIVERY -> INSERT cash payment (VERIFIED)
  -> balance = 0 -> commit. No history row: history logs STATUS changes only.

## 5. Non-obvious lines, explained

- `Math.floor((n + 1) / 2)` - integer ceil(n/2). No floats touch money, ever.
- `.strict()` on every schema - unknown keys are rejected, so a typo'd field
  fails loudly instead of being silently ignored.
- `walletFields` split from `.refine()` - zod's refine returns a wrapper with
  no `.shape`; the base object must stay separate for field reuse. (This exact
  bug was caught and fixed during Phase 3 testing.)
- Route order in `adminProducts.js` - `/movements` is declared BEFORE `/:id`,
  or Express reads "movements" as an id. Declaration order IS matching order.
- `CASE WHEN ... LIKE '%maya%' THEN 'PAYMAYA'` in migration 003 - legacy
  channels map to the new wallet enum; unknown channels import as NULL so an
  admin sees the gap instead of a wrong value.
- `LEGACY_PBKDF2_MUST_RESET__` password prefix - imported hashes can never
  verify under bcrypt (wrong format AND wrong prefix), forcing one reset while
  keeping the row auditable.

## 6. What was verified (all passing)

1. `node --check` on all 20 new/changed files.
2. Unit tests: downpayment round-up (31525->15763), balance identity,
   transition legality/illegality, cancel window, stock-return rule, stock
   status boundaries (0/500/501), 299-vs-300 bundles, +63 rejection, type-twice
   mismatch, adjust exactly-one rule, CONFIRMED rejected from board moves.
3. Live boot: public products with dead DB -> generic 500 (no leak, no stack
   in production); track/create/cancel validation -> bilingual 400s; admin
   routes without token -> 401.
4. Hardening found by testing: driver error codes no longer leak (`code` is
   forced to SERVER_ERROR on 500s); missing fields now bilingual.

## 7. What you learned

- **Pessimistic locking** (`SELECT ... FOR UPDATE`): correctness first for
  money/stock writes; the loser gets a clear error instead of corrupting data.
- **State machines beat scattered ifs**: one transition map + DB CHECKs make
  illegal states unrepresentable in two independent layers.
- **Append-only audit trails**: stock is a counter, movements are the truth;
  any discrepancy is findable by replaying the log.
- **Idempotency keys**: retries are a fact of networks; keys turn "did my
  order go through?" from a duplicate charge into a safe replay.
- **Legacy migration discipline**: stash (000) -> create (001/002) -> import
  (003), every step guarded, every insert duplicate-proof.

## 8. Known gaps (intentional - next phases)

- Payment submission, approve (stock deduction), reject + resubmit-once,
  and ALL emails -> Phase 4 (needs Brevo mailer + Storage + OTP tables).
- Member registration linking past guest orders -> Phase 4 (needs OTP proof).
- POS walk-in sales, sales reports + PDF, settings UI, admin dashboard UI,
  verification queue UI, refund queue UI -> Phase 5.
- Public site, checkout UI, tracking UI, cancel UI, i18n toggle -> Phase 6.
