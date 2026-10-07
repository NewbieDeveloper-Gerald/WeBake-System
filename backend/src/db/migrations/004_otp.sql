-- =====================================================================
-- WeBake migration 004: database-backed OTP codes.
--
-- WHY the database instead of memory: Render free tier restarts dynos on
-- every deploy and sleeps them when idle. An in-memory Map would wipe all
-- pending codes on each restart (the old code's exact flaw). Rows survive.
--
-- LIFECYCLE: request inserts a row (code HASH, never plain) -> verify marks
-- verified_at (single use: verified rows cannot verify again) -> the
-- consuming action (register, checkout, reset) sets consumed_at. Expired or
-- consumed rows are harmless leftovers; a periodic DELETE keeps the table
-- small (see otpService.prune, called opportunistically on each request).
-- =====================================================================

CREATE TABLE IF NOT EXISTS otp_codes (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  purpose       TEXT NOT NULL CHECK (purpose IN ('REGISTER', 'CHECKOUT', 'RESET')),
  expires_at    TIMESTAMPTZ NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  verified_at   TIMESTAMPTZ NULL,
  consumed_at   TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_email_purpose ON otp_codes (email, purpose);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes (expires_at);
