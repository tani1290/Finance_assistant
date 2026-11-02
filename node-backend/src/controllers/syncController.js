/**
 * Controller for the local-first sync API.
 *
 * This is a thin HTTP layer. All ordering, idempotency, concurrency and
 * encryption rules live in `services/syncService.js`; the controller only
 * translates request bodies into service calls and service errors into the
 * response envelope used by the rest of the API.
 */

'use strict';

const syncService = require('../services/syncService');

function failure(res, error, fallbackMessage) {
  if (error instanceof syncService.SyncError) {
    return res.status(error.statusCode).json({
      success: false,
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  console.error('[Sync] Unhandled error:', error);
  return res.status(500).json({
    success: false,
    error: 'SERVER_ERROR',
    message: fallbackMessage,
  });
}

function deviceIdFrom(req) {
  const fromBody = req.body && req.body.deviceId;
  const fromQuery = req.query && req.query.deviceId;
  const fromHeader = req.get('x-device-id');
  const value = fromBody || fromQuery || fromHeader;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

exports.bootstrap = async (req, res) => {
  try {
    const data = await syncService.bootstrap(req.user.id, deviceIdFrom(req));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return failure(res, error, 'Failed to bootstrap sync state');
  }
};

exports.pull = async (req, res) => {
  try {
    const data = await syncService.pull(req.user.id, { deviceId: deviceIdFrom(req) });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return failure(res, error, 'Failed to pull sync snapshot');
  }
};

exports.push = async (req, res) => {
  try {
    const operations = req.body && req.body.operations;
    if (!Array.isArray(operations)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'operations must be an array',
      });
    }

    const data = await syncService.push(req.user.id, {
      deviceId: deviceIdFrom(req),
      operations,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return failure(res, error, 'Failed to push sync operations');
  }
};

exports.status = async (req, res) => {
  try {
    const data = await syncService.status(req.user.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return failure(res, error, 'Failed to read sync status');
  }
};

exports.listConflicts = async (req, res) => {
  try {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'OPEN';
    const limit = Number(req.query.limit);
    const data = await syncService.listConflicts(req.user.id, {
      status: statusFilter,
      limit: Number.isFinite(limit) ? limit : 100,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return failure(res, error, 'Failed to list sync conflicts');
  }
};

exports.resolveConflict = async (req, res) => {
  try {
    const { conflictId } = req.params;
    const resolution = req.body && req.body.resolution;
    if (!resolution) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'resolution is required (LOCAL or SERVER)',
      });
    }

    const data = await syncService.resolveConflict(req.user.id, {
      conflictId,
      resolution,
      deviceId: deviceIdFrom(req),
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return failure(res, error, 'Failed to resolve sync conflict');
  }
};

exports.createBackup = async (req, res) => {
  try {
    const data = await syncService.createBackup(req.user.id, {
      deviceId: deviceIdFrom(req),
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return failure(res, error, 'Failed to create cloud backup');
  }
};

exports.listBackups = async (req, res) => {
  try {
    const limit = Number(req.query.limit);
    const data = await syncService.listBackups(req.user.id, {
      limit: Number.isFinite(limit) ? limit : 20,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return failure(res, error, 'Failed to list cloud backups');
  }
};

exports.restoreBackup = async (req, res) => {
  try {
    const { backupId } = req.params;
    const mode = (req.body && req.body.mode) || 'replace';
    const confirm = req.body && req.body.confirm === true;
    const data = await syncService.restoreBackup(req.user.id, backupId, {
      mode,
      confirm,
      deviceId: deviceIdFrom(req),
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return failure(res, error, 'Failed to restore cloud backup');
  }
};

exports.listAudit = async (req, res) => {
  try {
    const limit = Number(req.query.limit);
    const data = await syncService.listAudit(req.user.id, {
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return failure(res, error, 'Failed to read sync audit trail');
  }
};
