/**
 * Payments controller: customer submission + admin approve/reject + queue.
 *
 * Identity for submission reuses the cancel rule (member token wins, else
 * guest email in body) via the shared identityFrom() helper.
 */

'use strict';

const paymentService = require('../services/paymentService');
const verificationService = require('../services/verificationService');
const { identityFrom } = require('./ordersController');

async function submit(req, res) {
  const result = await paymentService.submitDownpayment(
    req.params.code,
    identityFrom(req),
    { channel: req.body.channel, reference_number: req.body.reference_number },
    req.file
  );
  const msg = result.resubmitted
    ? 'Corrected payment submitted. It is now pending verification.'
    : 'Downpayment submitted. It is now pending verification.';
  return res.status(201).json({
    success: true,
    message: msg,
    message_en: msg,
    ...result,
  });
}

async function approve(req, res) {
  const result = await paymentService.approveDownpayment(req.params.code, req.admin.email);
  return res.json({
    success: true,
    message: 'Downpayment verified. Order is now Confirmed.',
    message_en: 'Downpayment verified. Order is now Confirmed.',
    ...result,
  });
}

async function reject(req, res) {
  const result = await paymentService.rejectDownpayment(
    req.params.code, req.admin.email, req.body.reason
  );
  const msg = result.resubmit_allowed
    ? 'Payment rejected. Customer may resubmit once.'
    : 'Payment rejected. Order cancelled; refund awaits wallet details.';
  return res.json({
    success: true,
    message: msg,
    message_en: msg,
    ...result,
  });
}

async function queue(req, res) {
  const result = await verificationService.queue();
  return res.json({ success: true, ...result });
}

module.exports = { submit, approve, reject, queue };
