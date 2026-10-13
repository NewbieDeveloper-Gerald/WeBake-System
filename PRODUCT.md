# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Wholesale & Bulk Customers:** Local canteens, convenience stores, resellers, and event organizers ordering buns and rolls in wholesale bundles (e.g. 20 pieces per bundle), uploading 50% e-wallet downpayment proofs, and tracking delivery progress.
- **Walk-in Retail Patrons:** Physical store customers purchasing counter pieces or bundles on the spot with cash.
- **Bakery Staff & Cashier:** Front-counter personnel processing walk-in transactions, calculating change, and printing instant thermal receipts.
- **Bakery Owner & Admin:** The business manager inspecting payment proofs via image zoom, approving production batches, collecting delivery balances, managing product stock, and exporting sales PDFs.

## Product Purpose

WeBake provides Crumbs N' Roll Bakery with a unified sales and inventory management web platform. It eliminates manual paper logbook errors, prevents stock overselling between wholesale and retail channels, enforces a secure 50% downpayment verification workflow, and provides automated financial accounting.

## Positioning

A dual-channel bakery management system that unifies wholesale bundle ordering (with mandatory deposit and delivery scheduling) and fast in-person walk-in POS cashiering into a single, atomic piece-level PostgreSQL inventory with zero data collisions.

## Operating Context

- Fast-paced commercial bakery environment with morning baking rushes and counter lines.
- Mixed hardware: mobile phones for storefront customers, desktop PCs or tablets for counter POS and admin verification.
- Payment ecosystem: Philippine e-wallets (GCash, Maya) via QR code transfers and screenshot uploads, combined with physical cash transactions on delivery handover.
- Philippine Standard Time (Asia/Manila, UTC+8) reporting anchor.

## Capabilities and Constraints

- **Unified Dual-Unit Stock:** Master inventory is tracked in atomic pieces (`stock_pieces`). Bundle availability is calculated dynamically (`Floor(stock_pieces / pieces_per_bundle)`).
- **Atomic Concurrency Control:** Row-level locks (`SELECT ... FOR UPDATE`) in PostgreSQL transactions guarantee no overselling on concurrent approvals or POS sales.
- **Order State Machine:** `PAYMENT_UNDER_VERIFICATION` → `CONFIRMED` → `IN_PRODUCTION` → `OUT_FOR_DELIVERY` → `COMPLETED` (or `CANCELLED`).
- **50% Downpayment Policy:** Wholesale bookings require 50% online deposit; confirmed orders lock out cancel/refund actions to protect committed ingredients.
- **Financial Segregation:** Distinct tracking for Online Downpayments, Walk-in POS Cash, Delivery Collected Balances, and Outstanding Receivables.
- **Dispute Governance:** Dropdown reason selections for customer cancellations, admin proof rejections, and refund disputes.
- **Server-Side PDF Reporting:** PDFKit streaming engine generating formal daily, weekly, and monthly sales reports directly from the database.

## Brand Commitments

- **Entity:** Crumbs N' Roll Bakery (System: WeBake).
- **Aesthetic Tone:** Warm artisanal bakery. Earthy, appetizing, and dependable palette featuring terracotta (`#6B352A`), dark espresso (`#3E241B`), golden caramel (`#C88A58`), forest green accents (`#2D6A4F`), and warm cream backgrounds (`#FBF8F4`).
- **Currency & Formats:** Philippine Peso (`₱`) with 2 decimal places across all views.
- **Tone of Voice:** Practical, warm, transparent, and direct Philippine English.

## Evidence on Hand

- Fully migrated 11-table relational schema on Supabase PostgreSQL (3NF).
- Express.js backend with Zod validation, JWT authentication, and atomic database transactions.
- Implemented storefront, customer dashboard, admin dashboard, walk-in POS, and sales report interfaces.

## Product Principles

1. **One True Inventory Pool:** Every piece sold at the counter or booked wholesale updates the master inventory atomically; no channel can oversell the other.
2. **No Unverified Buns in the Oven:** Production never begins without a verified 50% downpayment receipt.
3. **Financial Stream Transparency:** Downpayments, walk-in counter cash, and delivery balances are kept strictly separated; the owner always knows the exact source of every peso.
4. **Counter-Speed Usability:** Walk-in POS and verification queues prioritize rapid scanability, clear touch targets, and zero interface latency.

## Accessibility & Inclusion

- High visual contrast ratios for text and stat cards to maintain legibility in flour-dusted or bright bakery environments.
- Generous interactive tap targets (minimum 44×44px) for mobile ordering and tablet POS operation.
- Clear step-by-step modal flows with inline validation and descriptive error messaging.

