/**
 * Payments controller: customer submission + admin approve/reject + queue.
 *
 * Identity for submission reuses the cancel rule (member token wins, else
 * guest email in body) via the shared identityFrom() helper - one rule, one
 * implementation, imported rather than copied.
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
  return res.status(201).json({
    success: true,
    message_en: result.resubmitted
      ? 'Corrected payment submitted. It is now pending verification.'
      : 'Downpayment submitted. It is now pending verification.',
    message_fil: result.resubmitted
      ? 'Naisumite ang itinamang bayad. Naghihintay ito ng beripikasyon.'
      : 'Naisumite ang downpayment. Naghihintay ito ng beripikasyon.',
    ...result,
  });
}

async function approve(req, res) {
  const result = await paymentService.approveDownpayment(req.params.code, req.admin.email);
  return res.json({
    success: true,
    message_en: 'Downpayment verified. Order is now Confirmed.',
    message_fil: 'Na-verify ang downpayment. Confirmed na ang order.',
    ...result,
  });
}

async function reject(req, res) {
  const result = await paymentService.rejectDownpayment(
    req.params.code, req.admin.email, req.body.reason
  );
  return res.json({
    success: true,
    message_en: result.resubmit_allowed
      ? 'Payment rejected. Customer may resubmit once.'
      : 'Payment rejected. Order cancelled; refund awaits wallet details.',
    message_fil: result.resubmit_allowed
      ? 'Tinanggihan ang bayad. Maaaring magsumite ulit ang customer nang isang beses.'
      : 'Tinanggihan ang bayad. Kanselado ang order; naghihintay ng wallet details ang refund.',
    ...result,
  });
}

async function queue(req, res) {
  const result = await verificationService.queue();
  return res.json({ success: true, ...result });
}

module.exports = { submit, approve, reject, queue };
