/**
 * English email templates (pure functions: data in, {subject, html, text}).
 *
 * WHAT: All 8 customer/owner emails.
 * Amounts arrive in centavos and format here via formatPesos().
 * Modern, responsive HTML styling with warm bakery branding.
 */

'use strict';

const { formatPesos } = require('../utils/money');

const BRAND = {
  bg: '#F8F4EE',
  card: '#FFFFFF',
  border: '#E8DBD0',
  cocoa: '#3E241B',
  primary: '#6B352A',
  gold: '#B58A44',
  goldLight: '#FFF8EB',
  cinnamon: '#B5523A',
  muted: '#7A685D',
  softBg: '#FAF6F1',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Shared shell: brand header + content + footer. Content is inner HTML. */
function base(title, preheader, contentHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
    + `<title>${title}</title></head>`
    + `<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">`
    + `<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</span>`
    + `<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:${BRAND.bg};">`
    + `<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" `
    + `style="max-width:580px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:16px;box-shadow:0 8px 24px rgba(62,36,27,0.06);overflow:hidden;">`
    + `<!-- Header -->`
    + `<tr><td style="padding:28px 24px;text-align:center;background:linear-gradient(135deg, #4A231A 0%, #6B352A 100%);">`
    + `<div style="font-size:26px;font-weight:800;color:#FFFFFF;letter-spacing:0.5px;">We<span style="color:#E5B25D;">Bake</span></div>`
    + `<div style="font-size:11px;color:#F2DDD0;font-weight:600;letter-spacing:1px;margin-top:4px;text-transform:uppercase;">Crumbs N' Rolls Bakery &bull; Marilao, Bulacan</div>`
    + `</td></tr>`
    + `<!-- Main Body -->`
    + `<tr><td style="padding:32px 28px;">${contentHtml}</td></tr>`
    + `<!-- Footer -->`
    + `<tr><td style="padding:20px 24px;background:${BRAND.softBg};border-top:1px solid ${BRAND.border};`
    + `text-align:center;font-size:12px;line-height:1.6;color:${BRAND.muted};">`
    + `<strong>WeBake Bakery — Fresh from our oven to you</strong><br>`
    + `1356 Cordero St., Lambakin, Marilao, Bulacan<br>`
    + `Questions? Contact us at <a href="mailto:crbwebake@gmail.com" style="color:${BRAND.primary};text-decoration:none;font-weight:600;">crbwebake@gmail.com</a>`
    + `</td></tr>`
    + `</table></td></tr></table></body></html>`;
}

const h2 = (t) => `<h2 style="margin:0 0 14px;font-size:21px;font-weight:700;color:${BRAND.cocoa};line-height:1.3;">${t}</h2>`;
const p = (t) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:${BRAND.cocoa};">${t}</p>`;
const btn = (url, label) => `<p style="text-align:center;margin:24px 0 16px;"><a href="${url}" `
  + `style="display:inline-block;padding:13px 32px;background:${BRAND.primary};color:#FFFFFF;`
  + `text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(107,53,42,0.25);">${label}</a></p>`;

function itemRows(items) {
  return items.map((it) => {
    const pcs = it.bundles * it.pieces_per_bundle;
    return `<tr><td style="padding:10px 8px;border-bottom:1px solid ${BRAND.border};font-size:13px;color:${BRAND.cocoa};">`
      + `<strong>${esc(it.product_name)}</strong><br>`
      + `<span style="color:${BRAND.muted};font-size:12px;">${it.bundles} bundle(s) &bull; ${pcs} pcs</span></td>`
      + `<td align="right" style="padding:10px 8px;border-bottom:1px solid ${BRAND.border};font-size:13px;font-weight:700;color:${BRAND.cocoa};">`
      + `${formatPesos(it.line_total_centavos)}</td></tr>`;
  }).join('');
}

// ---------------------------------------------------------------- 1. OTP ---
function otpCode({ code, purpose, minutes }) {
  const titles = {
    REGISTER: 'Verify your email to create your WeBake account',
    CHECKOUT: 'Verify your email to complete your order checkout',
    RESET: 'Verify your email to reset your account password',
  };
  const subject = `${code} is your WeBake verification code`;
  const html = base('Verification Code', subject,
    h2('Email Verification Code')
    + p(titles[purpose] || titles.CHECKOUT)
    + `<div style="text-align:center;margin:24px 0;padding:24px 16px;background:${BRAND.goldLight};border:2px dashed ${BRAND.gold};border-radius:12px;">`
    + `<div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:36px;font-weight:800;letter-spacing:10px;color:${BRAND.cocoa};margin-bottom:6px;">${code}</div>`
    + `<div style="display:inline-block;padding:3px 12px;background:#FFE8BA;color:#7A4E00;border-radius:12px;font-size:12px;font-weight:600;">Valid for ${minutes} minutes</div>`
    + `</div>`
    + p(`For your security, never share this one-time code with anyone. If you didn't request this code, you can safely ignore this email.`));
  const text = `${titles[purpose] || ''}\nCode: ${code}\nExpires in ${minutes} minutes.`;
  return { subject, html, text };
}

// --------------------------------------- 2. Acknowledgement receipt (Q3) ----
function acknowledgementReceipt({ order, items }) {
  const subject = `Order Acknowledgement — ${order.order_code} (Pending Verification)`;
  const money = (label, c, strong, color) =>
    `<tr><td style="font-size:13px;padding:6px 0;color:${strong ? BRAND.cocoa : BRAND.muted};font-weight:${strong ? 700 : 500};">${label}</td>`
    + `<td align="right" style="font-size:${strong ? '16px' : '14px'};font-weight:${strong ? 800 : 700};`
    + `color:${color || (strong ? BRAND.cinnamon : BRAND.cocoa)};padding:6px 0;">${formatPesos(c)}</td></tr>`;
  const html = base('Acknowledgement Receipt', subject,
    `<div style="margin-bottom:16px;"><span style="display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;`
    + `background:#F0AD4E;color:#FFFFFF;letter-spacing:0.5px;">PENDING VERIFICATION</span></div>`
    + h2('Order Acknowledgement Receipt')
    + p(`Thank you for ordering with WeBake! We received your order <strong>${esc(order.order_code)}</strong> and your submitted 50% downpayment proof.`)
    + `<div style="background:${BRAND.softBg};border:1px solid ${BRAND.border};border-radius:10px;padding:14px 16px;margin:16px 0 20px;">`
    + `<div style="font-size:12px;font-weight:700;color:${BRAND.primary};text-transform:uppercase;margin-bottom:6px;">Customer &amp; Delivery Details</div>`
    + `<div style="font-size:13px;color:${BRAND.cocoa};line-height:1.5;">`
    + `<strong>Customer:</strong> ${esc(order.customer_name)} &bull; ${esc(order.customer_contact)}<br>`
    + `<strong>Address:</strong> ${esc(order.delivery_address)}`
    + `</div></div>`
    + `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">`
    + `<thead><tr><th align="left" style="font-size:12px;color:${BRAND.muted};border-bottom:2px solid ${BRAND.border};padding-bottom:6px;">Item</th>`
    + `<th align="right" style="font-size:12px;color:${BRAND.muted};border-bottom:2px solid ${BRAND.border};padding-bottom:6px;">Amount</th></tr></thead>`
    + `<tbody>${itemRows(items)}</tbody></table>`
    + `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid ${BRAND.border};padding-top:10px;">`
    + money('Order Total:', order.total_centavos, false)
    + money('Submitted Downpayment (50%):', order.downpayment_centavos, false, '#2E7D32')
    + money('Remaining Balance (Cash on Delivery):', order.balance_due_centavos, true, BRAND.primary)
    + `</table>`
    + `<p style="margin-top:20px;font-size:12px;line-height:1.5;color:${BRAND.muted};">`
    + `Note: Our team will verify your GCash/Maya reference number and receipt screenshot shortly. Once approved, you will receive a confirmation email and production will begin.`
    + `</p>`);
  const lines = items.map((it) => `- ${it.product_name} x ${it.bundles} bundle(s) = ${formatPesos(it.line_total_centavos)}`);
  const text = `WEBAKE ACKNOWLEDGEMENT RECEIPT (PENDING VERIFICATION)\nOrder: ${order.order_code}\n`
    + `Customer: ${order.customer_name} (${order.customer_contact})\nAddress: ${order.delivery_address}\n`
    + `${lines.join('\n')}\nTotal: ${formatPesos(order.total_centavos)}\n`
    + `Downpayment submitted: ${formatPesos(order.downpayment_centavos)}\n`
    + `Balance (cash on delivery): ${formatPesos(order.balance_due_centavos)}`;
  return { subject, html, text };
}

// ------------------------------------------------ 3. Downpayment approved ---
function downpaymentApproved({ order, trackUrl }) {
  const subject = `Payment Verified — Order ${order.order_code} Confirmed!`;
  const html = base('Downpayment Verified', subject,
    `<div style="margin-bottom:16px;"><span style="display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;`
    + `background:#2E7D32;color:#FFFFFF;letter-spacing:0.5px;">PAYMENT VERIFIED &bull; CONFIRMED</span></div>`
    + h2('Your Payment is Verified!')
    + p(`Great news! Your 50% downpayment of <strong>${formatPesos(order.downpayment_centavos)}</strong> for order <strong>${esc(order.order_code)}</strong> has been verified by the bakery.`)
    + p(`Your freshly baked wholesale batch is now scheduled and queued for production.`)
    + `<div style="background:${BRAND.goldLight};border-left:4px solid ${BRAND.gold};padding:14px 16px;border-radius:0 8px 8px 0;margin:18px 0;">`
    + `<div style="font-size:13px;color:${BRAND.cocoa};"><strong>Cash on Delivery Reminder:</strong> Please prepare <strong>${formatPesos(order.balance_due_centavos)}</strong> in cash upon delivery.</div>`
    + `</div>`
    + btn(trackUrl, 'Track Order Status'));
  const text = `DOWNPAYMENT VERIFIED\nOrder ${order.order_code} is now Confirmed.\n`
    + `Downpayment: ${formatPesos(order.downpayment_centavos)}\nBalance (cash): ${formatPesos(order.balance_due_centavos)}\nTrack: ${trackUrl}`;
  return { subject, html, text };
}

// -------------------------------------------- 4. Refund request received ----
function refundRequestReceived({ order, refund }) {
  const subject = `Refund Request Recorded — Order ${order.order_code}`;
  const html = base('Refund Request Received', subject,
    `<div style="margin-bottom:16px;"><span style="display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;`
    + `background:#1976D2;color:#FFFFFF;letter-spacing:0.5px;">REFUND PROCESSING</span></div>`
    + h2('Refund Request Received')
    + p(`Your cancellation for order <strong>${esc(order.order_code)}</strong> was recorded.`)
    + p(`The bakery will transfer your refund of <strong>${formatPesos(refund.refund_amount_centavos)}</strong> directly to your provided e-wallet details:`)
    + `<div style="background:${BRAND.softBg};border:1px solid ${BRAND.border};border-radius:10px;padding:14px 16px;margin:16px 0;">`
    + `<div style="font-size:13px;color:${BRAND.cocoa};line-height:1.6;">`
    + `<strong>Wallet Provider:</strong> ${esc(refund.wallet_type)}<br>`
    + `<strong>Account Name:</strong> ${esc(refund.account_name)}<br>`
    + `<strong>Account Number:</strong> ${esc(refund.account_number)}`
    + `</div></div>`
    + p(`<em>Please double check these details. If any information is incorrect, please contact the bakery immediately.</em>`));
  const text = `REFUND REQUEST RECEIVED\nOrder: ${order.order_code}\nAmount: ${formatPesos(refund.refund_amount_centavos)}\n`
    + `Wallet: ${refund.wallet_type} ${refund.account_number} (${refund.account_name})\nCannot be edited - contact the bakery if wrong.`;
  return { subject, html, text };
}

// ----------------------------------------------- 5. Downpayment rejected ---
function downpaymentRejected({ order, reason, resubmitAllowed, actionUrl }) {
  const subject = resubmitAllowed
    ? `Action Required: Please Resubmit Payment for Order ${order.order_code}`
    : `Payment Rejected — Order ${order.order_code} Cancelled`;
  const badge = resubmitAllowed ? '#E65100' : '#C62828';
  const badgeText = resubmitAllowed ? 'ACTION REQUIRED' : 'PAYMENT REJECTED';
  const en = resubmitAllowed
    ? `Your downpayment submission for order <strong>${esc(order.order_code)}</strong> could not be verified by the bakery.<br><br>`
      + `<div style="background:#FFF3E0;border-left:4px solid #FF9800;padding:12px 14px;border-radius:0 8px 8px 0;margin:14px 0;font-size:13px;color:#BF360C;">`
      + `<strong>Reason provided by bakery:</strong><br>${esc(reason)}</div>`
      + `You have <strong>ONE chance</strong> to resubmit a valid reference number and clear screenshot receipt so we can confirm your order.`
    : `Your downpayment submission for order <strong>${esc(order.order_code)}</strong> was rejected:<br><br>`
      + `<div style="background:#FFEBEE;border-left:4px solid #E53935;padding:12px 14px;border-radius:0 8px 8px 0;margin:14px 0;font-size:13px;color:#C62828;">`
      + `<strong>Reason:</strong> ${esc(reason)}</div>`
      + `This order has now been <strong>Cancelled</strong>. Please provide your GCash or PayMaya wallet details at the link below so we can process your refund.`;
  const html = base('Downpayment Notice', subject,
    `<div style="margin-bottom:16px;"><span style="display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;`
    + `background:${badge};color:#FFFFFF;letter-spacing:0.5px;">${badgeText}</span></div>`
    + h2(resubmitAllowed ? 'Please Resubmit Your Payment' : 'Order Payment Rejected')
    + p(en)
    + btn(actionUrl, resubmitAllowed ? 'Resubmit Payment Proof' : 'Submit Wallet for Refund'));
  const text = `DOWNPAYMENT REJECTED\nOrder: ${order.order_code}\nReason: ${reason}\n`
    + (resubmitAllowed ? 'You have ONE chance to resubmit.' : 'Order cancelled. Submit wallet details for refund.')
    + `\n${actionUrl}`;
  return { subject, html, text };
}

// ------------------------------------------------- 6. Refund completed -----
function refundCompleted({ order, refund }) {
  const refLine = refund.admin_reference_number
    ? `<br><strong>Wallet Reference No.:</strong> ${esc(refund.admin_reference_number)}` : '';
  const subject = `Refund Sent — ${formatPesos(refund.refund_amount_centavos)} for Order ${order.order_code}`;
  const html = base('Refund Sent', subject,
    `<div style="margin-bottom:16px;"><span style="display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;`
    + `background:#2E7D32;color:#FFFFFF;letter-spacing:0.5px;">REFUND COMPLETED</span></div>`
    + h2('Refund Transferred')
    + p(`The bakery has successfully sent your refund of <strong>${formatPesos(refund.refund_amount_centavos)}</strong> to your ${esc(refund.wallet_type)} account.`)
    + `<div style="background:${BRAND.softBg};border:1px solid ${BRAND.border};border-radius:10px;padding:14px 16px;margin:16px 0;">`
    + `<div style="font-size:13px;color:${BRAND.cocoa};line-height:1.6;">`
    + `<strong>Wallet:</strong> ${esc(refund.wallet_type)} (${esc(refund.account_number)})`
    + `${refLine}`
    + `</div></div>`
    + p(`Please allow a short period for your mobile wallet balance to reflect the transaction.`));
  const text = `REFUND SENT\nOrder: ${order.order_code}\nAmount: ${formatPesos(refund.refund_amount_centavos)}\n`
    + `Wallet: ${refund.wallet_type} ${refund.account_number}\nReference: ${refund.admin_reference_number || 'n/a'}`;
  return { subject, html, text };
}

// ------------------------------------- 7. Refund closed (no payment sent) ---
function refundClosed({ order, refund }) {
  const subject = `Refund Review Closed — Order ${order.order_code}`;
  const html = base('Refund Closed', subject,
    `<div style="margin-bottom:16px;"><span style="display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;`
    + `background:#757575;color:#FFFFFF;letter-spacing:0.5px;">CASE CLOSED</span></div>`
    + h2('Refund Review Completed')
    + p(`Following a thorough review of transaction logs for order <strong>${esc(order.order_code)}</strong>, no verified payment transfer was located. Consequently, no refund payout will be initiated.`)
    + `<div style="background:#EEEEEE;border-left:4px solid #757575;padding:12px 14px;border-radius:0 8px 8px 0;margin:16px 0;font-size:13px;color:#424242;">`
    + `<strong>Bakery Note:</strong><br>${esc(refund.admin_note)}</div>`
    + p(`If you have proof showing funds were debited, please reply directly to this email with official transaction records.`));
  const text = `REFUND CLOSED (NO PAYMENT)\nOrder: ${order.order_code}\nBakery note: ${refund.admin_note}\n`
    + `Reply with proof if this is a mistake.`;
  return { subject, html, text };
}

// ------------------------------------------------- 8. Admin reset link -----
function adminResetLink({ url, minutes }) {
  const subject = 'WeBake Admin Password Reset Request';
  const html = base('Admin Password Reset', subject,
    h2('Reset Admin Account Password')
    + p(`A password reset request was initiated for the WeBake bakery administrator account. This link expires in <strong>${minutes} minutes</strong> and can only be used once.`)
    + btn(url, 'Reset Admin Password')
    + p(`If you did not initiate this password reset, please secure your credentials immediately.`));
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
