'use strict';

/**
 * Image uploads for the class feed. Only the two roles that may create posts
 * can upload, and only the exact file name pattern written by the storage
 * engine can be deleted (no path traversal).
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const uploads = require('../lib/uploads');
const { asyncHandler } = require('../lib/http');
const { notFound, badRequest } = require('../lib/errors');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const SAFE_NAME = /^\d{10,}-[0-9a-f]{16}\.(jpg|png|webp|gif)$/;

router.use(requireAuth);

router.post(
  '/',
  requireRole('admin', 'teacher'),
  uploads.upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No image was received. Use the "file" field.', 'no_file');
    res.status(201).json({
      data: {
        filename: req.file.filename,
        url: uploads.publicUrl(req.file.filename),
        bytes: req.file.size,
        mimeType: req.file.mimetype,
        maxBytes: config.uploads.maxBytes,
      },
    });
  }),
);

router.delete(
  '/:filename',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const { filename } = req.params;
    if (!SAFE_NAME.test(filename)) throw badRequest('That is not a valid upload name.');

    const target = path.join(config.uploads.dir, filename);
    // Defence in depth: the resolved path must stay inside the upload folder.
    if (!path.resolve(target).startsWith(path.resolve(config.uploads.dir))) {
      throw badRequest('That is not a valid upload name.');
    }
    if (!fs.existsSync(target)) throw notFound('That file does not exist.');

    fs.unlinkSync(target);
    res.json({ data: { deleted: true, filename } });
  }),
);

module.exports = router;
module.exports.SAFE_NAME = SAFE_NAME;
