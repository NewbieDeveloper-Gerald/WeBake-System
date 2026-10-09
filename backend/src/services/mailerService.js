/**
 * Brevo transactional mailer (HTTPS - works on Render free tier).
 *
 * WHAT: Thin client over POST https://api.brevo.com/v3/smtp/email plus one
 * send* function per template. SMTP ports are blocked on Render free, so every
 * send goes over HTTPS with the BREVO_API_KEY header.
 *
 * DISABLED MODE: without BREVO_API_KEY the mailer throws 503 MAILER_DISABLED.
 * Callers choose their policy: OTP requests FAIL (a code you cannot receive is
 * useless), while receipt/refund emails are BEST-EFFORT (the order/refund
 * transaction already committed; email must never roll it back). Use the
 * bestEffort() helper for the second case - it logs instead of throwing.
 */

'use strict';

const config = require('../config/env');
const { fail } = require('../utils/serviceError');
const T = require('./emailTemplates');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function isEnabled() {
  return config.brevo.apiKey !== '';
}

function trackUrl(orderCode) {
  // Contract: Phase 6 implements this tracking page path.
  return `${config.cors.frontendUrl}/customer/html/track.html?code=${encodeURIComponent(orderCode)}`;
}

async function sendMail({ to, subject, html, text }) {
  if (!isEnabled()) {
    if (config.nodeEnv !== 'production') {
      console.log(`[mailer:dev] Mock email to ${to}: ${subject}`);
      return { messageId: 'dev-mock-id' };
    }
    throw fail(503, 'MAILER_DISABLED',
      'Email service is not configured. Please contact the bakery.',
      'Hindi naka-configure ang email service. Pakikontak ang bakery.');
  }
  let res;
  try {
    res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': config.brevo.apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: config.brevo.senderName, email: config.brevo.senderEmail },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
  } catch (err) {
    throw fail(502, 'EMAIL_FAILED',
      'Email service is unreachable. Please try again later.',
      'Hindi maabot ang email service. Pakisubukang muli mamaya.');
  }
  if (!res.ok) {
    // Log Brevo's detail server-side; the client gets a generic message.
    const detail = await res.text().catch(() => '');
    console.error(`[mailer] Brevo rejected send to ${to}: HTTP ${res.status} ${detail.slice(0, 300)}`);
    throw fail(502, 'EMAIL_FAILED',
      'Email could not be delivered. Please try again later.',
      'Hindi naipadala ang email. Pakisubukang muli mamaya.');
  }
  return res.json().catch(() => ({}));
}

/**
 * Fire-and-forget wrapper for post-commit emails. Logs failures with enough
 * context for the owner to follow up manually (order code + recipient).
 */
function bestEffort(promise, label) {
  promise.catch((err) => {
    console.error(`[mailer] best-effort FAILED (${label}):`, err.message || err);
  });
}

// --- One sender per template. All take plain data, no req/res. ---

function sendOtp(to, { code, purpose, minutes }) {
  const t = T.otpCode({ code, purpose, minutes });
  return sendMail({ to, ...t });
}

function sendReceipt(to, { order, items }) {
  const t = T.acknowledgementReceipt({ order, items });
  return sendMail({ to, ...t });
}

function sendApproved(to, { order }) {
  const t = T.downpaymentApproved({ order, trackUrl: trackUrl(order.order_code) });
  return sendMail({ to, ...t });
}

function sendRefundReceived(to, { order, refund }) {
  const t = T.refundRequestReceived({ order, refund });
  return sendMail({ to, ...t });
}

function sendRejected(to, { order, reason, resubmitAllowed }) {
  const t = T.downpaymentRejected({ order, reason, resubmitAllowed, actionUrl: trackUrl(order.order_code) });
  return sendMail({ to, ...t });
}

function sendRefundCompleted(to, { order, refund }) {
  const t = T.refundCompleted({ order, refund });
  return sendMail({ to, ...t });
}

function sendRefundClosed(to, { order, refund }) {
  const t = T.refundClosed({ order, refund });
  return sendMail({ to, ...t });
}

function sendAdminReset(to, { url, minutes }) {
  const t = T.adminResetLink({ url, minutes });
  return sendMail({ to, ...t });
}

module.exports = {
  isEnabled,
  trackUrl,
  sendMail,
  bestEffort,
  sendOtp,
  sendReceipt,
  sendApproved,
  sendRefundReceived,
  sendRejected,
  sendRefundCompleted,
  sendRefundClosed,
  sendAdminReset,
};
