/**
 * Rate limiters (brute-force protection).
 *
 * WHAT: Caps how often one IP can hit sensitive endpoints.
 *
 * WHY: Login, OTP, cancel, and refund-details endpoints all accept secrets
 * (passwords, 6-digit codes, order emails). Without limits, an attacker can
 * guess thousands of times per minute. Limits turn that into a handful.
 *
 * NOTE: express-rate-limit stores counters in memory. That is correct for one
 * Render instance; if the API ever scales to multiple instances, swap `store`
 * for a shared Redis/Upstash store. All four limiters are defined here now so
 * later phases just import and attach them.
 */

'use strict';

const rateLimit = require('express-rate-limit');

function bilingualLimiter({ windowMinutes, max, code, message_en, message_fil }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: 'draft-7', // RateLimit-* headers so clients can back off.
    legacyHeaders: false,
    // Same JSON shape as every other error, so the frontend needs no special case.
    handler: (req, res) => res.status(429).json({
      success: false,
      code,
      message_en,
      message_fil,
    }),
  });
}

/** Login: 10 attempts per 15 minutes per IP. Generous for humans, slow for bots. */
const loginLimiter = bilingualLimiter({
  windowMinutes: 15,
  max: 10,
  code: 'RATE_LIMIT_LOGIN',
  message_en: 'Too many sign-in attempts. Please try again in 15 minutes.',
  message_fil: 'Masyadong maraming pagtatangka sa pag-sign in. Subukan ulit pagkalipas ng 15 minuto.',
});

/** OTP send/verify: 5 per 15 minutes. Six-digit codes must stay unguessable. */
const otpLimiter = bilingualLimiter({
  windowMinutes: 15,
  max: 5,
  code: 'RATE_LIMIT_OTP',
  message_en: 'Too many verification attempts. Please try again later.',
  message_fil: 'Masyadong maraming pagtatangka sa beripikasyon. Subukan ulit mamaya.',
});

/** Order cancel: 10 per hour. Stops enumeration of Order ID + email pairs. */
const cancelLimiter = bilingualLimiter({
  windowMinutes: 60,
  max: 10,
  code: 'RATE_LIMIT_CANCEL',
  message_en: 'Too many cancellation attempts. Please try again later.',
  message_fil: 'Masyadong maraming pagtatangka sa pagkansela. Subukan ulit mamaya.',
});

/** Refund-details submit: 10 per hour, same reasoning as cancel. */
const refundDetailsLimiter = bilingualLimiter({
  windowMinutes: 60,
  max: 10,
  code: 'RATE_LIMIT_REFUND',
  message_en: 'Too many attempts. Please try again later.',
  message_fil: 'Masyadong maraming pagtatangka. Subukan ulit mamaya.',
});

/** Payment proof upload: 20 per hour. Bounds storage abuse from one IP. */
const paymentLimiter = bilingualLimiter({
  windowMinutes: 60,
  max: 20,
  code: 'RATE_LIMIT_PAYMENT',
  message_en: 'Too many payment submissions. Please try again later.',
  message_fil: 'Masyadong maraming pagsusumite ng bayad. Subukan ulit mamaya.',
});

module.exports = { loginLimiter, otpLimiter, cancelLimiter, refundDetailsLimiter, paymentLimiter };
