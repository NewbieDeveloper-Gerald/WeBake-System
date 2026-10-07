/**
 * Cart controller: member-only cart sync (guest carts live in localStorage).
 */

'use strict';

const cartService = require('../services/cartService');

async function get(req, res) {
  const items = await cartService.get(req.member.id);
  return res.json({ success: true, items });
}

async function put(req, res) {
  const items = await cartService.set(req.member.id, req.body.items, req.body.merge);
  return res.json({ success: true, items });
}

module.exports = { get, put };
