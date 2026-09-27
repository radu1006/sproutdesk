'use strict';

/**
 * Class feed media uploads (photos of activities for the parent feed).
 * Files are stored on disk under UPLOAD_DIR and served back from
 * /uploads/<generated-name>.<ext>. Only images are accepted here.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const config = require('../config');
const { badRequest } = require('./errors');

const ALLOWED_MIME = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

fs.mkdirSync(config.uploads.dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploads.dir),
  filename: (req, file, cb) => {
    const extension =
      ALLOWED_MIME.get(file.mimetype) || path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(badRequest('Only JPEG, PNG, WEBP or GIF images can be uploaded.', 'unsupported_media'));
      return;
    }
    cb(null, true);
  },
});

/** Public URL for a stored file. */
function publicUrl(filename) {
  return `${config.uploads.publicPrefix}/${filename}`;
}

module.exports = { upload, publicUrl, ALLOWED_MIME };
