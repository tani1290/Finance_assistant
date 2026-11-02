/**
 * Authenticated local-first sync routes.
 *
 * Mounted below `router.use(authenticate)` in routes/index.js, so every request
 * already carries `req.user`. Nothing here is public: financial data, backups
 * and tombstones are always scoped to the authenticated user.
 */

'use strict';

const express = require('express');
const sync = require('../controllers/syncController');

const router = express.Router();

// Handshake: server revision, backup readiness, device registration.
router.get('/bootstrap', sync.bootstrap);
router.post('/bootstrap', sync.bootstrap);

// Pull the authoritative snapshot (full rows + tombstones + categories).
router.get('/pull', sync.pull);

// Push a durable batch of queued local operations. Idempotent on (userId, opId).
router.post('/push', sync.push);

// Queue health for the settings screen.
router.get('/status', sync.status);

// Conflicts are explicit; the client must choose LOCAL or SERVER.
router.get('/conflicts', sync.listConflicts);
router.post('/conflicts/:conflictId/resolve', sync.resolveConflict);

// Encrypted cloud backups.
router.post('/backups', sync.createBackup);
router.get('/backups', sync.listBackups);
router.post('/backups/:backupId/restore', sync.restoreBackup);

// Read-only audit trail of applied sync operations.
router.get('/audit', sync.listAudit);

module.exports = router;
