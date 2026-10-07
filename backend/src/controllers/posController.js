/**
 * POS controller: record a counter sale, list recent sales.
 */

'use strict';

const posService = require('../services/posService');

async function sale(req, res) {
  const receipt = await posService.createSale(
    req.body.items, req.body.cash_received_centavos, req.admin.email
  );
  return res.status(201).json({ success: true, receipt });
}

async function recent(req, res) {
  const sales = await posService.recentSales(
    req.query.limit ? Number(req.query.limit) : 50
  );
  return res.json({ success: true, count: sales.length, sales });
}

module.exports = { sale, recent };
