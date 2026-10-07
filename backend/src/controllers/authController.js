/**
 * Authentication controller (HTTP translation for login).
 *
 * WHAT: Takes req.body, calls the service, sends the JSON response.
 *
 * WHY so thin: if HTTP details (status codes, JSON shape) stay here and
 * decisions stay in the service, either side can change without touching the
 * other. Controllers never write SQL and never decide business rules.
 */

'use strict';

const authService = require('../services/authService');

async function memberLogin(req, res) {
  // req.body was already validated + cleaned by validateBody(loginSchema).
  const { email, password } = req.body;
  const result = await authService.loginMember(email, password);
  return res.status(200).json({ success: true, ...result });
}

async function adminLogin(req, res) {
  const { email, password } = req.body;
  const result = await authService.loginAdmin(email, password);
  return res.status(200).json({ success: true, ...result });
}

/** GET /api/auth/me - lets the frontend confirm "who am I" after reload. */
async function me(req, res) {
  // Exactly one of these is set, depending on which guard ran first.
  if (req.admin) {
    return res.json({ success: true, role: 'admin', admin: req.admin });
  }
  return res.json({ success: true, role: 'member', member: req.member });
}

module.exports = { memberLogin, adminLogin, me };
