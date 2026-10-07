/**
 * Proof-photo upload middleware (multer, memory storage).
 *
 * WHAT: Accepts one image file (field name "proof"), max 5MB, JPEG/PNG/WebP.
 *
 * WHY memory storage: the file goes straight to Supabase Storage from the
 * buffer - nothing touches the Render disk, so concurrent uploads cannot fill
 * it and no cleanup cron is needed. Multer's own errors are translated into
 * the standard bilingual JSON shape.
 */

'use strict';

const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB: phone photos fit, abuse does not.
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

/** Wraps multer so its errors become bilingual 400s instead of HTML/crashes. */
function uploadProof(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    let message_en = 'Photo upload failed. Please try again.';
    let message_fil = 'Nabigo ang pag-upload ng larawan. Pakisubukang muli.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message_en = 'Photo must be 5MB or smaller.';
      message_fil = 'Ang larawan ay dapat 5MB o mas maliit.';
    } else if (err.code === 'BAD_FILE_TYPE') {
      message_en = 'Only JPG, PNG, or WebP photos are accepted.';
      message_fil = 'JPG, PNG, o WebP na larawan lang ang tinatanggap.';
    }
    return res.status(400).json({
      success: false, code: 'UPLOAD_INVALID', message_en, message_fil,
    });
  });
}

module.exports = uploadProof;
