/**
 * Members controller: registration, profile, and password flows.
 * Registration auto-signs-in (returns a JWT) so checkout continues smoothly.
 */

'use strict';

const memberService = require('../services/memberService');
const passwordResetService = require('../services/passwordResetService');

async function register(req, res) {
  const result = await memberService.register(req.body);
  return res.status(201).json({
    success: true,
    message_en: 'Account created. Welcome to WeBake!',
    message_fil: 'Nagawa ang account. Maligayang pagdating sa WeBake!',
    ...result,
  });
}

async function profile(req, res) {
  const member = await memberService.getProfile(req.member.id);
  return res.json({ success: true, member });
}

async function updateProfile(req, res) {
  const member = await memberService.updateProfile(req.member.id, req.body);
  return res.json({ success: true, member });
}

async function changePassword(req, res) {
  await memberService.changePassword(
    req.member.id, req.body.current_password, req.body.new_password
  );
  return res.json({
    success: true,
    message_en: 'Password changed successfully.',
    message_fil: 'Napalitan ang password.',
  });
}

async function resetPassword(req, res) {
  await memberService.resetPasswordWithOtp(req.body.email, req.body.new_password);
  return res.json({
    success: true,
    message_en: 'Password reset. You can now sign in.',
    message_fil: 'Na-reset ang password. Maaari ka nang mag-sign in.',
  });
}

async function adminForgot(req, res) {
  const result = await passwordResetService.requestAdminReset(req.body.email);
  return res.json({ success: true, ...result });
}

async function adminReset(req, res) {
  await passwordResetService.confirmAdminReset(req.body.token, req.body.new_password);
  return res.json({
    success: true,
    message_en: 'Admin password reset. You can now sign in.',
    message_fil: 'Na-reset ang admin password. Maaari ka nang mag-sign in.',
  });
}

module.exports = {
  register, profile, updateProfile, changePassword, resetPassword,
  adminForgot, adminReset,
};
