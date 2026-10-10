/**
 * Settings controller: admin read/update + public checkout subset.
 */

'use strict';

const settingsService = require('../services/settingsService');

async function getAll(req, res) {
  const settings = await settingsService.getAll();
  return res.json({ success: true, settings });
}

async function update(req, res) {
  const settings = await settingsService.update(req.body);
  return res.json({
    success: true,
    message: 'Settings saved.',
    message_en: 'Settings saved.',
    settings,
  });
}

async function getPublic(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const settings = await settingsService.getPublic();
  return res.json({ success: true, settings });
}

module.exports = { getAll, update, getPublic };
