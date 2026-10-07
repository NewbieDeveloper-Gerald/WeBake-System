/**
 * OTP routes.
 *   POST /api/otp/send    {email, purpose} -> emails a 6-digit code
 *   POST /api/otp/verify  {email, purpose, code} -> stamps verified_at
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { otpLimiter } = require('../middleware/rateLimits');
const { validateBody } = require('../validators/common');
const { requestSchema, verifySchema } = require('../validators/otp');
const otpController = require('../controllers/otpController');

const router = express.Router();

router.post('/send', otpLimiter, validateBody(requestSchema), asyncHandler(otpController.send));
router.post('/verify', otpLimiter, validateBody(verifySchema), asyncHandler(otpController.verify));

module.exports = router;
