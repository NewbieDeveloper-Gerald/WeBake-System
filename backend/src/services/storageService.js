/**
 * Supabase Storage service for private payment-proof photos.
 *
 * WHAT: uploadProof streams a multer buffer into the private "payment-proofs"
 * bucket; signedViewUrl generates short-lived URLs for the owner dashboard.
 *
 * PRIVACY RULE: the bucket is NOT public. Only signed URLs work, so customers
 * cannot browse other people's bank receipts or reference numbers.
 *
 * GRACEFUL DEGRADATION: when keys are missing in dev, upload/view mock the
 * storage layer with a log line + placeholder SVG, so the team can work
 * offline without Supabase credentials.
 */

'use strict';

const { StorageClient } = require('@supabase/storage-js');
const config = require('../config/env');
const { fail } = require('../utils/serviceError');

const PROOFS_BUCKET = config.storage.proofsBucket || 'payment-proofs';
let client = null;

function isEnabled() {
  return config.storage.url !== '' && config.storage.serviceRoleKey !== '';
}

function getClient() {
  if (!isEnabled()) {
    throw fail(503, 'STORAGE_DISABLED',
      'File storage is not configured. Please contact the bakery.');
  }
  if (!client) {
    const rawUrl = config.storage.url.replace(/\/$/, '');
    const storageUrl = rawUrl.endsWith('/storage/v1') ? rawUrl : `${rawUrl}/storage/v1`;
    const storage = new StorageClient(storageUrl, {
      apikey: config.storage.serviceRoleKey,
      Authorization: `Bearer ${config.storage.serviceRoleKey}`,
    });
    client = { storage };
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
  if (!isEnabled()) {
    if (config.nodeEnv !== 'production') {
      console.log(`[storage:dev] Mock proof uploaded for order ${orderCode}: ${path}`);
      return { path: `dev-proofs/${path}` };
    }
    throw fail(503, 'STORAGE_DISABLED',
      'File storage is not configured. Please contact the bakery.');
  }
  const { error } = await getClient().storage
    .from(PROOFS_BUCKET)
    .upload(path, buffer, { contentType: mimetype, upsert: false });
  if (error) {
    console.error('[storage] proof upload failed:', error.message);
    throw fail(502, 'UPLOAD_FAILED',
      'Proof photo could not be saved. Please try again.');
  }
  return { path };
}

/** 15-minute signed URL for admin viewing of a private proof. */
async function signedViewUrl(path, seconds = 900) {
  if (!isEnabled()) {
    if (config.nodeEnv !== 'production') {
      return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="%23eee"/><text x="50%" y="50%" font-size="14" text-anchor="middle" fill="%23666">Proof Mock (${path})</text></svg>`;
    }
    throw fail(503, 'STORAGE_DISABLED',
      'File storage is not configured. Please contact the bakery.');
  }
  const { data, error } = await getClient().storage
    .from(PROOFS_BUCKET)
    .createSignedUrl(path, seconds);
  if (error || !data) {
    throw fail(404, 'PROOF_NOT_FOUND',
      'Proof photo not found.');
  }
  return data.signedUrl;
}

module.exports = { PROOFS_BUCKET, isEnabled, uploadProof, signedViewUrl };
