/**
 * Rate limiters (brute-force protection).
 *
 * WHAT: Caps how often one IP can hit sensitive endpoints.
 */

'use strict';

const rateLimit = require('express-rate-limit');

function createLimiter({ windowMinutes, max, code, message }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      success: false,
      code,
      message,
      message_en: message,
    }),
  });
}

/** Login: 10 attempts per 15 minutes per IP. */
const loginLimiter = createLimiter({
  windowMinutes: 15,
  max: 10,
  code: 'RATE_LIMIT_LOGIN',
  message: 'Too many sign-in attempts. Please try again in 15 minutes.',
});

/** OTP send/verify: 5 per 15 minutes. */
const otpLimiter = createLimiter({
  windowMinutes: 15,
  max: 5,
  code: 'RATE_LIMIT_OTP',
  message: 'Too many verification attempts. Please try again later.',
});

/** Order cancel: 10 per hour. */
const cancelLimiter = createLimiter({
  windowMinutes: 60,
  max: 10,
  code: 'RATE_LIMIT_CANCEL',
  message: 'Too many cancellation attempts. Please try again later.',
});

/** Refund-details submit: 10 per hour. */
const refundDetailsLimiter = createLimiter({
  windowMinutes: 60,
  max: 10,
  code: 'RATE_LIMIT_REFUND',
  message: 'Too many attempts. Please try again later.',
});

/** Payment proof upload: 20 per hour. */
const paymentLimiter = createLimiter({
  windowMinutes: 60,
  max: 20,
  code: 'RATE_LIMIT_PAYMENT',
  message: 'Too many payment submissions. Please try again later.',
});

module.exports = { loginLimiter, otpLimiter, cancelLimiter, refundDetailsLimiter, paymentLimiter };
