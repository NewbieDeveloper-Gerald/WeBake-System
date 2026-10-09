/**
 * Proof-photo upload middleware (multer, memory storage).
 *
 * WHAT: Accepts one image file (field name "proof"), max 5MB, JPEG/PNG/WebP.
 */

'use strict';

const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter(req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    const err = new Error('Only JPG, PNG, or WebP photos are accepted.');
    err.code = 'BAD_FILE_TYPE';
    return cb(err);
  },
}).single('proof');

function uploadProof(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    let message = 'Photo upload failed. Please try again.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Photo must be 5MB or smaller.';
    } else if (err.code === 'BAD_FILE_TYPE') {
      message = 'Only JPG, PNG, or WebP photos are accepted.';
    }
    return res.status(400).json({
      success: false,
      code: 'UPLOAD_INVALID',
      message,
      message_en: message,
    });
  });
}

module.exports = uploadProof;
