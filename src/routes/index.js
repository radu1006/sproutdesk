'use strict';

/**
 * API router aggregator. Every module below is mounted inside server.js
 * under /api, so the effective URL of `router.get('/')` in users.js is
 * GET /api/users.
 */

const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../lib/http');

const router = express.Router();

/** GET /api/health - used by deployment checks and by the frontend boot screen. */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const database = await db.health();
    res.json({
      data: {
        status: 'ok',
        engine: db.dialect,
        database,
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
      },
    });
  }),
);

router.use('/auth', require('./auth'));
router.use('/dashboard', require('./dashboard'));
router.use('/users', require('./users'));
router.use('/classrooms', require('./classrooms'));
router.use('/children', require('./children'));
router.use('/attendance', require('./attendance'));
router.use('/daily-reports', require('./dailyReports'));
router.use('/observations', require('./observations'));
router.use('/posts', require('./posts'));
router.use('/announcements', require('./announcements'));
router.use('/events', require('./events'));
router.use('/invoices', require('./invoices'));
router.use('/messages', require('./messages'));
router.use('/settings', require('./settings'));
router.use('/uploads', require('./uploads'));

module.exports = router;
