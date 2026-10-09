/**
 * OTP controller: request a code, verify a code.
 * Both endpoints sit behind otpLimiter (5 per 15 min per IP) at the router.
 */

'use strict';

const otpService = require('../services/otpService');

async function send(req, res) {
  const result = await otpService.requestCode(req.body.email, req.body.purpose);
  return res.json({
    success: true,
    message: 'Verification code sent to your email.',
    message_en: 'Verification code sent to your email.',
    ...result,
  });
}

async function verify(req, res) {
  const result = await otpService.verifyCode(req.body.email, req.body.code, req.body.purpose);
  return res.json({
    success: true,
    message: 'Email verified successfully.',
    message_en: 'Email verified successfully.',
    ...result,
  });
}

module.exports = { send, verify };
