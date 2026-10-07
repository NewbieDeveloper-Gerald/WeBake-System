/**
 * Reports controller: sales JSON for the dashboard + PDF download.
 * Both read the same reportService.getSales() object (screen == export).
 */

'use strict';

const reportService = require('../services/reportService');
const dashboardService = require('../services/dashboardService');

async function sales(req, res) {
  const report = await reportService.getSales(req.query.period, req.query.anchor);
  return res.json({ success: true, report });
}

async function salesPdf(req, res) {
  const report = await reportService.getSales(req.query.period, req.query.anchor);
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

module.exports = { sales, salesPdf, dashboard };
