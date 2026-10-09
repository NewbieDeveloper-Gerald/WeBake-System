/**
 * English email templates (pure functions: data in, {subject, html, text}).
 *
 * WHAT: All 8 customer/owner emails.
 * Amounts arrive in centavos and format here via formatPesos().
 */

'use strict';

const { formatPesos } = require('../utils/money');

const BRAND = {
  cream: '#FDF9F3',
  card: '#FFFFFF',
  border: '#E6D7C8',
  cocoa: '#3E241B',
  cinnamon: '#B5523A',
  muted: '#7A685D',
};

/** Shared shell: brand header + content + footer. Content is inner HTML. */
function base(title, preheader, contentHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
    + `<title>${title}</title></head>`
    + `<body style="margin:0;padding:0;background:${BRAND.cream};font-family:Arial,Helvetica,sans-serif;">`
    + `<span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>`
    + `<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">`
    + `<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" `
    + `style="max-width:560px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">`
    + `<tr><td style="padding:24px;text-align:center;background:${BRAND.cream};border-bottom:1px solid ${BRAND.border};">`
    + `<div style="font-size:24px;font-weight:800;color:${BRAND.cocoa};">We<span style="color:${BRAND.cinnamon};">Bake</span></div>`
    + `<div style="font-size:12px;color:${BRAND.muted};">Crumbs N' Rolls Bakery - Marilao, Bulacan</div>`
    + `</td></tr><tr><td style="padding:24px;">${contentHtml}</td></tr>`
    + `<tr><td style="padding:16px 24px;background:${BRAND.cream};border-top:1px solid ${BRAND.border};`
    + `text-align:center;font-size:11px;color:${BRAND.muted};">`
    + `1356 Cordero St., Lambakin, Marilao, Bulacan<br>crbwebake@gmail.com</td></tr>`
    + `</table></td></tr></table></body></html>`;
}

const h2 = (t) => `<h2 style="margin:0 0 12px;font-size:19px;color:${BRAND.cocoa};">${t}</h2>`;
const p = (t) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${BRAND.cocoa};">${t}</p>`;
const btn = (url, label) => `<p style="text-align:center;margin:20px 0;"><a href="${url}" `
  + `style="display:inline-block;padding:12px 28px;background:${BRAND.cinnamon};color:#fff;`
  + `text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">${label}</a></p>`;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function itemRows(items) {
  return items.map((it) => {
    const pcs = it.bundles * it.pieces_per_bundle;
    return `<tr><td style="padding:8px;border-bottom:1px solid ${BRAND.border};font-size:13px;">`
      + `<strong>${esc(it.product_name)}</strong><br>`
      + `<span style="color:${BRAND.muted};font-size:12px;">${it.bundles} bundle(s) - ${pcs} pcs</span></td>`
      + `<td align="right" style="padding:8px;border-bottom:1px solid ${BRAND.border};font-size:13px;">`
      + `${formatPesos(it.line_total_centavos)}</td></tr>`;
  }).join('');
}

// ---------------------------------------------------------------- 1. OTP ---
function otpCode({ code, purpose, minutes }) {
  const titles = {
    REGISTER: 'Verify your email to activate your WeBake account',
    CHECKOUT: 'Verify your email to place your order',
    RESET: 'Verify your email to reset your password',
  };
  const subject = `${code} is your WeBake verification code`;
  const html = base('Verification code', subject,
    h2('Your verification code')
    + p(titles[purpose] || titles.CHECKOUT)
    + `<p style="text-align:center;margin:20px 0;"><span style="display:inline-block;padding:14px 26px;`
    + `background:${BRAND.cream};border:2px dashed ${BRAND.cinnamon};border-radius:10px;`
    + `font-family:monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:${BRAND.cocoa};">${code}</span></p>`
    + p(`This code expires in ${minutes} minutes. Never share it with anyone.`));
  const text = `${titles[purpose] || ''}\nCode: ${code}\nExpires in ${minutes} minutes.`;
  return { subject, html, text };
}

// --------------------------------------- 2. Acknowledgement receipt (Q3) ----
function acknowledgementReceipt({ order, items }) {
  const subject = `WeBake acknowledgement receipt - ${order.order_code} (pending verification)`;
  const money = (label, c, strong) =>
    `<tr><td style="font-size:13px;color:${BRAND.muted};">${label}</td>`
    + `<td align="right" style="font-size:${strong ? '16px' : '14px'};font-weight:${strong ? 800 : 700};`
    + `color:${strong ? BRAND.cinnamon : BRAND.cocoa};">${formatPesos(c)}</td></tr>`;
  const html = base('Acknowledgement receipt', subject,
    `<p style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;`
    + `background:#B9862F;color:#fff;">PENDING VERIFICATION</p>`
    + h2('Acknowledgement Receipt')
    + p(`Order <strong>${esc(order.order_code)}</strong> received. Your 50% downpayment is `
      + `awaiting verification by the bakery. This is not yet proof of payment.`)
    + p(`<strong>Customer:</strong> ${esc(order.customer_name)} (${esc(order.customer_contact)})<br>`
      + `<strong>Address:</strong> ${esc(order.delivery_address)}`)
    + `<table width="100%" cellpadding="0" cellspacing="0">${itemRows(items)}</table>`
    + `<table width="100%" cellpadding="4" cellspacing="0" style="margin-top:12px;">`
    + money('Order total:', order.total_centavos, false)
    + money('Downpayment submitted:', order.downpayment_centavos, false)
    + money('Remaining balance (cash on delivery):', order.balance_due_centavos, true)
    + `</table>`);
  const lines = items.map((it) => `- ${it.product_name} x ${it.bundles} bundle(s) = ${formatPesos(it.line_total_centavos)}`);
  const text = `WEBAKE ACKNOWLEDGEMENT RECEIPT (PENDING VERIFICATION)\nOrder: ${order.order_code}\n`
    + `Customer: ${order.customer_name} (${order.customer_contact})\nAddress: ${order.delivery_address}\n`
    + `${lines.join('\n')}\nTotal: ${formatPesos(order.total_centavos)}\n`
    + `Downpayment submitted: ${formatPesos(order.downpayment_centavos)}\n`
    + `Balance (cash): ${formatPesos(order.balance_due_centavos)}`;
  return { subject, html, text };
}

// ------------------------------------------------ 3. Downpayment approved ---
function downpaymentApproved({ order, trackUrl }) {
  const subject = `Downpayment verified - ${order.order_code} is now Confirmed`;
  const html = base('Downpayment verified', subject,
    h2('Downpayment verified')
    + p(`Good news! Your downpayment of <strong>${formatPesos(order.downpayment_centavos)}</strong> `
      + `for order <strong>${esc(order.order_code)}</strong> has been verified. Your order is now `
      + `<strong>Confirmed</strong> and queued for production.`)
    + p(`Please prepare <strong>${formatPesos(order.balance_due_centavos)}</strong> in cash upon delivery.`)
    + btn(trackUrl, 'Track My Order'));
  const text = `DOWNPAYMENT VERIFIED\nOrder ${order.order_code} is now Confirmed.\n`
    + `Downpayment: ${formatPesos(order.downpayment_centavos)}\nBalance (cash): ${formatPesos(order.balance_due_centavos)}\nTrack: ${trackUrl}`;
  return { subject, html, text };
}

// -------------------------------------------- 4. Refund request received ----
function refundRequestReceived({ order, refund }) {
  const subject = `Refund request received - ${order.order_code}`;
  const html = base('Refund request received', subject,
    h2('Refund request received')
    + p(`Your cancellation for order <strong>${esc(order.order_code)}</strong> was recorded. The bakery `
      + `will send <strong>${formatPesos(refund.refund_amount_centavos)}</strong> to your ${esc(refund.wallet_type)} `
      + `account (<strong>${esc(refund.account_name)}</strong>, ${esc(refund.account_number)}</strong>). `
      + `This cannot be edited - if the number is wrong, contact the bakery immediately.`));
  const text = `REFUND REQUEST RECEIVED\nOrder: ${order.order_code}\nAmount: ${formatPesos(refund.refund_amount_centavos)}\n`
    + `Wallet: ${refund.wallet_type} ${refund.account_number} (${refund.account_name})\nCannot be edited - contact the bakery if wrong.`;
  return { subject, html, text };
}

// ----------------------------------------------- 5. Downpayment rejected ---
function downpaymentRejected({ order, reason, resubmitAllowed, actionUrl }) {
  const subject = resubmitAllowed
    ? `Action needed: resubmit your payment for ${order.order_code}`
    : `Downpayment rejected - ${order.order_code} cancelled`;
  const en = resubmitAllowed
    ? `Your downpayment proof for order <strong>${esc(order.order_code)}</strong> was rejected: `
      + `<em>${esc(reason)}</em><br><br>You have <strong>ONE chance</strong> to resubmit a correct reference `
      + `number and proof photo. If the second submission also fails, the order is cancelled.`
    : `Your downpayment proof for order <strong>${esc(order.order_code)}</strong> was rejected: `
      + `<em>${esc(reason)}</em><br><br>The order is now <strong>Cancelled</strong>. Please submit your `
      + `GCash/PayMaya wallet details at the link below so the bakery can process your refund.`;
  const html = base('Downpayment rejected', subject,
    h2('Downpayment rejected') + p(en) + btn(actionUrl, resubmitAllowed ? 'Resubmit Payment' : 'Submit Wallet Details'));
  const text = `DOWNPAYMENT REJECTED\nOrder: ${order.order_code}\nReason: ${reason}\n`
    + (resubmitAllowed ? 'You have ONE chance to resubmit.' : 'Order cancelled. Submit wallet details for refund.')
    + `\n${actionUrl}`;
  return { subject, html, text };
}

// ------------------------------------------------- 6. Refund completed -----
function refundCompleted({ order, refund }) {
  const refLine = refund.admin_reference_number
    ? `Wallet reference: <strong>${esc(refund.admin_reference_number)}</strong><br>` : '';
  const subject = `Refund sent - ${formatPesos(refund.refund_amount_centavos)} for ${order.order_code}`;
  const html = base('Refund sent', subject,
    h2('Refund sent')
    + p(`The bakery has sent <strong>${formatPesos(refund.refund_amount_centavos)}</strong> to your `
      + `${esc(refund.wallet_type)} account (${esc(refund.account_number)}).<br>${refLine}`
      + `Please allow a few hours for the wallet to reflect the transfer.`));
  const text = `REFUND SENT\nOrder: ${order.order_code}\nAmount: ${formatPesos(refund.refund_amount_centavos)}\n`
    + `Wallet: ${refund.wallet_type} ${refund.account_number}\nReference: ${refund.admin_reference_number || 'n/a'}`;
  return { subject, html, text };
}

// ------------------------------------- 7. Refund closed (no payment sent) ---
function refundClosed({ order, refund }) {
  const subject = `Refund closed without payment - ${order.order_code}`;
  const html = base('Refund closed', subject,
    h2('Refund closed without payment')
    + p(`After review, no payment was found for order <strong>${esc(order.order_code)}</strong>, so no `
      + `refund will be sent. The bakery's note:<br><em>${esc(refund.admin_note)}</em><br><br>`
      + `If you believe this is a mistake, reply to this email with your proof of payment.`));
  const text = `REFUND CLOSED (NO PAYMENT)\nOrder: ${order.order_code}\nBakery note: ${refund.admin_note}\n`
    + `Reply with proof if this is a mistake.`;
  return { subject, html, text };
}

// ------------------------------------------------- 8. Admin reset link -----
function adminResetLink({ url, minutes }) {
  const subject = 'WeBake admin password reset';
  const html = base('Admin password reset', subject,
    h2('Reset your admin password')
    + p(`A password reset was requested for the WeBake owner account. The link expires in `
      + `${minutes} minutes and works once.`)
    + btn(url, 'Reset Password')
    + p(`If the button does not work, paste this into your browser:<br>${esc(url)}`));
  const text = `ADMIN PASSWORD RESET\nReset link (expires in ${minutes} min, one-time use):\n${url}`;
  return { subject, html, text };
}

module.exports = {
  otpCode,
  acknowledgementReceipt,
  downpaymentApproved,
  refundRequestReceived,
  downpaymentRejected,
  refundCompleted,
  refundClosed,
  adminResetLink,
};
