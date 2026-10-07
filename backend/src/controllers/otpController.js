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
    message_en: 'Verification code sent to your email.',
    message_fil: 'Naipadala ang verification code sa iyong email.',
    ...result,
  });
}

async function verify(req, res) {
  const result = await otpService.verifyCode(req.body.email, req.body.code, req.body.purpose);
  return res.json({
    success: true,
    message_en: 'Email verified successfully.',
    message_fil: 'Na-verify ang email.',
    ...result,
  });
}

module.exports = { send, verify };
