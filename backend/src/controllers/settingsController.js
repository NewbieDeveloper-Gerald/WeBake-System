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
    message_en: 'Settings saved.',
    message_fil: 'Na-save ang settings.',
    settings,
  });
}

async function getPublic(req, res) {
  const settings = await settingsService.getPublic();
  return res.json({ success: true, settings });
}

module.exports = { getAll, update, getPublic };
