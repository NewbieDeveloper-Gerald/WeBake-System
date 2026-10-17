/**
 * Reports controller: sales JSON for the dashboard + PDF download,
 * and partner payments management.
 */

'use strict';

const reportService = require('../services/reportService');
const dashboardService = require('../services/dashboardService');

async function sales(req, res) {
  const options = {
    from: req.query.from,
    to: req.query.to,
  };
  const report = await reportService.getSales(req.query.period, req.query.anchor, options);
  return res.json({ success: true, report });
}

async function salesPdf(req, res) {
  const options = {
    from: req.query.from,
    to: req.query.to,
  };
  const report = await reportService.getSales(req.query.period, req.query.anchor, options);
  const pdf = await reportService.renderPdf(report);
  const filename = `webake-sales-${report.period}-${report.from}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdf.length);
  return res.send(pdf);
}

async function dashboard(req, res) {
  const stats = await dashboardService.stats();
  return res.json({ success: true, stats });
}

async function unpaidOrders(req, res) {
  const customers = await reportService.getUnpaidOrders();
  return res.json({ success: true, customers });
}

async function recordPayment(req, res) {
  const result = await reportService.recordPartnerPayment({
    customer_name: req.body.customer_name,
    order_id: req.body.order_id,
    amount: req.body.amount,
    payment_method: req.body.payment_method,
    date_received: req.body.date_received,
    reference_number: req.body.reference_number,
    notes: req.body.notes,
    admin_email: req.user?.email || 'Store Manager',
  });
  return res.json({ success: true, ...result });
}

async function voidPayment(req, res) {
  const paymentId = parseInt(req.params.id, 10);
  const result = await reportService.voidPartnerPayment(paymentId, {
    reason: req.body.reason,
    admin_email: req.user?.email || 'Store Manager',
  });
  return res.json({ success: true, ...result });
}

module.exports = {
  sales,
  salesPdf,
  dashboard,
  unpaidOrders,
  recordPayment,
  voidPayment,
};
