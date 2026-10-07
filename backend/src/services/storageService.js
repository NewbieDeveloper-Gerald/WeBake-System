/**
 * Supabase Storage client: payment proofs (PRIVATE) + product images (PUBLIC).
 *
 * WHAT: uploadProof stores a proof photo under payment-proofs/<order>/...;
 * signedViewUrl mints a short-lived URL so the ADMIN can view a private proof
 * in the verification queue. Customers never receive proof URLs.
 *
 * WHY service-role key, server-side only: the private bucket denies anonymous
 * reads. The key lives in env, never leaves this process.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('../config/env');
const { fail } = require('../utils/serviceError');

const PROOFS_BUCKET = 'payment-proofs';

let client = null;

function isEnabled() {
  return config.storage.url !== '' && config.storage.serviceRoleKey !== '';
}

function getClient() {
  if (!isEnabled()) {
    throw fail(503, 'STORAGE_DISABLED',
      'File storage is not configured. Please contact the bakery.',
      'Hindi naka-configure ang file storage. Pakikontak ang bakery.');
  }
  if (!client) {
    client = createClient(config.storage.url, config.storage.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}

function extFor(mimetype) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  return map[mimetype] || 'bin';
}

async function uploadProof(buffer, { orderCode, mimetype }) {
  const safe = orderCode.replace(/[^A-Z0-9-]/gi, '');
  const path = `${safe}/${Date.now()}-proof.${extFor(mimetype)}`;
  const { error } = await getClient().storage
    .from(PROOFS_BUCKET)
    .upload(path, buffer, { contentType: mimetype, upsert: false });
  if (error) {
    console.error('[storage] proof upload failed:', error.message);
    throw fail(502, 'UPLOAD_FAILED',
      'Proof photo could not be saved. Please try again.',
      'Hindi na-save ang proof photo. Pakisubukang muli.');
  }
  return { path };
}

/** 15-minute signed URL for admin viewing of a private proof. */
async function signedViewUrl(path, seconds = 900) {
  const { data, error } = await getClient().storage
    .from(PROOFS_BUCKET)
    .createSignedUrl(path, seconds);
  if (error || !data) {
    throw fail(404, 'PROOF_NOT_FOUND',
      'Proof photo not found.',
      'Hindi nahanap ang proof photo.');
  }
  return data.signedUrl;
}

module.exports = { PROOFS_BUCKET, isEnabled, uploadProof, signedViewUrl };
